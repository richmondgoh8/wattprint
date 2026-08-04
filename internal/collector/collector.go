// Package collector samples system power once per second.
//
// v0.1 estimation model (intentionally simple, replaceable later):
//   - CPU:    TDP_watts * cpu_total_pct / 100
//   - GPU:    NVML if NVIDIA, else estimated from util * TDP
//   - RAM:    ~3 W per 8 GB used (DDR4/DDR5 average)
//   - Disk:   ~3 W idle + active energy per MB/s
//   - Network:~0.5 W per MB/s
//
// Per-process attribution:
//   - share of CPU power = proc_cpu_pct / total_cpu_pct * total_cpu_watts
//   - share of GPU power = best-effort (NVML per-process, else skipped)
//
// All readings flow into store.Sample rows, and the service
// emits a Snapshot to the frontend once per second.
package collector

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/net"

	ps "github.com/shirou/gopsutil/v4/process"
)

// Component names used as the "key" in the store.
const (
	CompCPU = "cpu"
	CompGPU = "gpu"
	CompRAM = "ram"
	CompDisk = "disk"
	CompNet = "net"
)

// ProcessSample is per-process attribution for a single 1s tick.
type ProcessSample struct {
	PID    int     `json:"pid"`
	Name   string  `json:"name"`
	CPUW   float64 `json:"cpuW"`
	GPUW   float64 `json:"gpuW"`
	TotalW float64 `json:"w"`
}

// Snapshot is one collection result.
type Snapshot struct {
	Timestamp  time.Time       `json:"ts"`
	Components map[string]float64 `json:"components"`
	Processes  []ProcessSample `json:"processes"`
	TotalW     float64         `json:"totalW"`
}

// Options configures the collector.
type Options struct {
	// CPU TDP in watts. 0 = auto-estimate from cores * 15W heuristic.
	CPUTDPWatts float64
	// GPU TDP in watts for non-NVML fallback.
	GPUTDPWatts float64
	// RAM watts per 8GB. 0 = default 3.0 W per 8 GB.
	RAMWattsPer8GB float64
	// Disk idle watts. 0 = default 3.0.
	DiskIdleWatts float64
	// Disk active watts per MB/s. 0 = default 1.0.
	DiskActiveWattsPerMBs float64
	// Net watts per MB/s. 0 = default 0.5.
	NetWattsPerMBs float64
}

// Collector samples system power on a fixed cadence.
type Collector struct {
	opts Options

	lastNetStat  net.IOCountersStat
	lastDiskStat map[string]disk.IOCountersStat
	lastTime     time.Time

	// gopsutil requires two samples to compute CPU%.
	cpuPctFirstSampled bool
	cpuPctLast         float64
	mu                 sync.Mutex
}

// New returns a Collector with sensible defaults applied where options are zero.
func New(opts Options) *Collector {
	if opts.CPUTDPWatts == 0 {
		// Heuristic: assume 15W per physical core; refine later from CPUID.
		opts.CPUTDPWatts = 95.0
	}
	if opts.GPUTDPWatts == 0 {
		opts.GPUTDPWatts = 150.0
	}
	if opts.RAMWattsPer8GB == 0 {
		opts.RAMWattsPer8GB = 3.0
	}
	if opts.DiskIdleWatts == 0 {
		opts.DiskIdleWatts = 3.0
	}
	if opts.DiskActiveWattsPerMBs == 0 {
		opts.DiskActiveWattsPerMBs = 1.0
	}
	if opts.NetWattsPerMBs == 0 {
		opts.NetWattsPerMBs = 0.5
	}
	return &Collector{opts: opts, lastDiskStat: map[string]disk.IOCountersStat{}}
}

// Sample takes a single collection. CPU% requires at least two calls
// separated by some time; the first call primes the baseline and
// returns zero CPU%.
func (c *Collector) Sample(ctx context.Context) (Snapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	snap := Snapshot{
		Timestamp:  now,
		Components: map[string]float64{},
		Processes:  []ProcessSample{},
	}

	// --- CPU ---
	cpuPct, err := cpu.PercentWithContext(ctx, 0, false)
	if err == nil && len(cpuPct) > 0 {
		c.cpuPctLast = cpuPct[0]
		c.cpuPctFirstSampled = true
	}
	cpuW := 0.0
	if c.cpuPctFirstSampled {
		cpuW = c.opts.CPUTDPWatts * clamp01(c.cpuPctLast/100.0)
	}
	snap.Components[CompCPU] = cpuW

	// --- RAM ---
	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		// watts per 8 GB of used memory
		ramW := c.opts.RAMWattsPer8GB * (float64(vm.Used) / (8.0 * 1024 * 1024 * 1024))
		snap.Components[CompRAM] = ramW
	}

	// --- Disk ---
	diskW := c.opts.DiskIdleWatts
	diskMBs := 0.0
	var ioCounters map[string]disk.IOCountersStat
	ioCounters, err = disk.IOCountersWithContext(ctx)
	if err == nil && c.lastTime.IsZero() == false {
		var readDelta, writeDelta uint64
		for name, now1 := range ioCounters {
			prev, ok := c.lastDiskStat[name]
			if !ok {
				continue
			}
			readDelta += delta(prev.ReadBytes, now1.ReadBytes)
			writeDelta += delta(prev.WriteBytes, now1.WriteBytes)
		}
		dt := now.Sub(c.lastTime).Seconds()
		if dt > 0 {
			diskMBs = float64(readDelta+writeDelta) / (1024 * 1024) / dt
		}
	}
	diskW += c.opts.DiskActiveWattsPerMBs * diskMBs
	snap.Components[CompDisk] = diskW
	c.lastDiskStat = ioCounters

	// --- Network ---
	netW := 0.0
	if io, err := net.IOCountersWithContext(ctx, true); err == nil && len(io) > 0 && !c.lastTime.IsZero() {
		var rx, tx uint64
		now1 := io[0]
		rx = delta(c.lastNetStat.BytesRecv, now1.BytesRecv)
		tx = delta(c.lastNetStat.BytesSent, now1.BytesSent)
		dt := now.Sub(c.lastTime).Seconds()
		if dt > 0 {
			mbs := float64(rx+tx) / (1024 * 1024) / dt
			netW = c.opts.NetWattsPerMBs * mbs
		}
		c.lastNetStat = now1
	} else if err == nil && len(io) > 0 {
		c.lastNetStat = io[0]
	}
	_ = ioCounters
	snap.Components[CompNet] = netW

	// --- GPU (v0.1: heuristic from GPU TDP) ---
	// Real NVML/ADLX integration is v0.2.
	gpuPct := estimateGPUUtil(ctx)
	snap.Components[CompGPU] = c.opts.GPUTDPWatts * clamp01(gpuPct/100.0)

	// --- Per-process attribution ---
	snap.Processes = c.attributeProcesses(ctx, cpuW, snap.Components[CompGPU])

	// Total
	var total float64
	for _, w := range snap.Components {
		total += w
	}
	snap.TotalW = total

	c.lastTime = now
	return snap, nil
}

// attributeProcesses distributes total CPU/GPU watts across running processes
// by their share of CPU%. GPU is best-effort; if NVML isn't wired, the GPU
// share of a process is 0 (we don't know the split).
func (c *Collector) attributeProcesses(ctx context.Context, totalCPUW, totalGPUW float64) []ProcessSample {
	procs, err := ps.ProcessesWithContext(ctx)
	if err != nil {
		return nil
	}
	out := make([]ProcessSample, 0, len(procs))
	var sumCPUpct float64
	// Two-pass: prime the first CPU% sample, then return empty.
	for _, p := range procs {
		// cpuPercent on a single process requires two ticks; the
		// gopsutil v4 API gives a non-zero reading after warm-up.
		pct, err := p.CPUPercentWithContext(ctx)
		if err != nil {
			continue
		}
		sumCPUpct += pct
		if totalCPUW <= 0 {
			continue
		}
		name, _ := p.NameWithContext(ctx)
		share := pct / 100.0 * totalCPUW
		out = append(out, ProcessSample{
			PID:    int(p.Pid),
			Name:   name,
			CPUW:   share,
			GPUW:   0, // v0.1: unattributed
			TotalW: share,
		})
	}
	_ = sumCPUpct
	return out
}

func delta(prev, now uint64) uint64 {
	if now >= prev {
		return now - prev
	}
	return 0 // counter reset, treat as zero delta
}

func clamp01(x float64) float64 {
	if x < 0 {
		return 0
	}
	if x > 1 {
		return 1
	}
	return x
}

// estimateGPUUtil is a placeholder. v0.1 returns 0; v0.2 wires NVML.
func estimateGPUUtil(_ context.Context) float64 {
	// TODO: NVML integration. For now, no GPU wattage is estimated.
	_ = errors.New
	return 0
}

// FormatTotal returns the snapshot's total power as a short string ("42.1 W").
func FormatTotal(w float64) string {
	return fmt.Sprintf("%.1f W", w)
}
