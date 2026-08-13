// Per-second system power sampler.
// Estimation model (measured where possible):
//   - CPU:    TDP × cpu% (load from host telemetry)
//   - GPU:    real power via vendor CLI (nvidia-smi / amd-smi); "—" if unavailable
//   - RAM:    ~3 W per 8 GB used (capped at 20 W — DIMMs saturate)
//   - Disk:   3 W idle + ~0.01 W per MB/s (capped at 15 W — NVMe peak ~8-10 W)
//   - Network: ~0.03 W per MB/s (capped at 12 W — NIC peak ~10-15 W)
// Per-process attribution splits CPU watts proportionally to each process's
// CPU-time share (sum of process watts ≈ CPU component watts).

import * as si from 'systeminformation'
import { cpus } from 'node:os'
import type { ProcessSample, SourceKind, SystemInfo } from '../shared/types.js'
import { getSystemInfo } from './hardware.js'
import { HostProcessHelper } from './hostProcesses.js'
import { GpuPowerProbe } from './gpuPower.js'

export interface CollectorOptions {
  cpuTDPWatts: number
  cpuTDPResolved: boolean
  ramWattsPer8GB: number
  diskIdleWatts: number
  diskActiveWattsPerMBs: number
  netWattsPerMBs: number
}

const DEFAULTS: CollectorOptions = {
  cpuTDPWatts: 95,
  cpuTDPResolved: false,
  ramWattsPer8GB: 3,
  diskIdleWatts: 3,
  diskActiveWattsPerMBs: 0.01,
  netWattsPerMBs: 0.03
}

// Upper bounds so a counter-overflow spike or extreme throughput can never
// produce physically impossible component wattage.
const MAX_DISK_W = 15
const MAX_NET_W = 12
const MAX_RAM_W = 20

interface NetPrev {
  rx: number
  tx: number
}
interface DiskPrev {
  rx: number
  wx: number
}

export interface SystemSnapshot {
  components: Record<string, number | null>
  componentSources: Record<string, SourceKind>
  cpuTdpW: number | null
  cpuTdpResolved: boolean
  processes: ProcessSample[]
  processCount: number
  totalW: number
  gpuUtilPct: number | null
  gpuTopProcess: { name: string; pct: number } | null
  gpuConsumers: { name: string; pct: number }[]
  cpuLoadPct: number | null
  memoryUsedBytes: number
  memoryTotalBytes: number
}

export class Collector {
  private opts: CollectorOptions
  private cpuPctLast = 0
  private cpuPctPrimed = false
  private lastTime = 0
  private prevNet: NetPrev | null = null
  private prevDisk = new Map<string, DiskPrev>()
  private hostHelper = new HostProcessHelper()
  private lhmDir: string | null = null
  private helperPrev = new Map<number, { lastPct: number }>()
  private lastAttributionAt = 0
  private logicalCores = cpus().length || 1
  private gpuProbe: GpuPowerProbe | null = null
  private gpuProbeConfigured = false
  private gpuUtilLast = 0
  private gpuUtilLastAt = 0
  private memUsedBytes = 0
  private memTotalBytes = 0
  // Fallback process listing is throttled (si.processes() spawns `ps`); the
  // last listing keeps serving between refreshes.
  private fallbackProcs: si.Systeminformation.ProcessesProcessData[] | null = null
  private fallbackProcsAt = 0

  constructor(opts: Partial<CollectorOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts }
  }

  /** Directory containing the vendored LibreHardwareMonitor DLLs. */
  setLhmDir(dir: string | null): void {
    this.lhmDir = dir
  }

  /** Reference TDP for the CPU estimation model (from the hardware lookup). */
  setCpuTdp(watts: number, resolved: boolean): void {
    this.opts.cpuTDPWatts = watts
    this.opts.cpuTDPResolved = resolved
  }

  /** Adjust how often the persistent host helper polls (ms). */
  setPollMs(ms: number): void {
    this.hostHelper.setPollMs(ms)
  }

  start(): void {
    this.hostHelper.start(this.lhmDir)
  }

  stop(): void {
    this.hostHelper.stop()
  }

  async sample(): Promise<SystemSnapshot> {
    const now = Date.now()
    const dt = this.lastTime === 0 ? 0 : (now - this.lastTime) / 1000
    const components: Record<string, number | null> = {}
    const helperLive = this.hostHelper.rows.length > 0
    const telemetry = this.hostHelper.telemetry

    // CPU
    if (helperLive && telemetry.cpuPct != null) {
      this.cpuPctLast = telemetry.cpuPct
      this.cpuPctPrimed = true
    } else {
      try {
        const load = await si.currentLoad()
        if (load.currentLoad > 0) {
          this.cpuPctLast = load.currentLoad
          this.cpuPctPrimed = true
        }
      } catch {
        // ignore
      }
    }
    components.cpu = this.cpuPctPrimed ? this.opts.cpuTDPWatts * clamp01(this.cpuPctLast / 100) : 0

    // RAM
    if (helperLive && telemetry.memUsedBytes != null && telemetry.memTotalBytes != null) {
      this.memUsedBytes = telemetry.memUsedBytes
      this.memTotalBytes = telemetry.memTotalBytes
      components.ram = estimateRamWatts(this.memUsedBytes, this.opts.ramWattsPer8GB, MAX_RAM_W)
    } else {
      try {
        const mem = await si.mem()
        this.memUsedBytes = mem.used
        this.memTotalBytes = mem.total
        components.ram = estimateRamWatts(mem.used, this.opts.ramWattsPer8GB, MAX_RAM_W)
      } catch {
        components.ram = 0
      }
    }

    // Disk
    let diskW = this.opts.diskIdleWatts
    if (helperLive && telemetry.diskReadBps != null && telemetry.diskWriteBps != null) {
      const mbs = Math.max(0, (telemetry.diskReadBps + telemetry.diskWriteBps) / (1024 * 1024))
      diskW = estimateDiskWatts(mbs, this.opts.diskIdleWatts, this.opts.diskActiveWattsPerMBs, MAX_DISK_W)
    } else if (dt > 0) {
      try {
        const fs = await si.fsStats()
        let bytesPerSec = 0
        if (fs.rx_sec != null && fs.wx_sec != null) {
          bytesPerSec = Math.max(0, (fs.rx_sec || 0) + (fs.wx_sec || 0))
        } else if (this.prevDisk.has('*')) {
          const prev = this.prevDisk.get('*')!
          const drx = Math.max(0, (fs.rx || 0) - prev.rx)
          const dwx = Math.max(0, (fs.wx || 0) - prev.wx)
          bytesPerSec = (drx + dwx) / dt
        }
        this.prevDisk.set('*', { rx: fs.rx || 0, wx: fs.wx || 0 })
        const mbs = Math.max(0, bytesPerSec / (1024 * 1024))
        diskW = estimateDiskWatts(mbs, this.opts.diskIdleWatts, this.opts.diskActiveWattsPerMBs, MAX_DISK_W)
      } catch {
        // ignore
      }
    }
    components.disk = diskW

    // Network
    let netW = 0
    if (helperLive && telemetry.netRxBps != null && telemetry.netTxBps != null) {
      const mbs = Math.max(0, (telemetry.netRxBps + telemetry.netTxBps) / (1024 * 1024))
      netW = estimateNetWatts(mbs, this.opts.netWattsPerMBs, MAX_NET_W)
    } else if (dt > 0) {
      try {
        const ns = await si.networkStats()
        const cur = ns.reduce(
          (acc, n) => ({ rx: acc.rx + (n.rx_bytes || 0), tx: acc.tx + (n.tx_bytes || 0) }),
          { rx: 0, tx: 0 }
        )
        if (this.prevNet) {
          const drx = Math.max(0, cur.rx - this.prevNet.rx)
          const dtx = Math.max(0, cur.tx - this.prevNet.tx)
          const mbs = ((drx + dtx) / dt) / (1024 * 1024)
          netW = estimateNetWatts(mbs, this.opts.netWattsPerMBs, MAX_NET_W)
        }
        this.prevNet = cur
      } catch {
        // ignore
      }
    }
    components.net = netW

    // GPU: real power — LibreHardwareMonitor via the host helper first, vendor
    // CLI (nvidia-smi / amd-smi) as fallback. Never estimated.
    await this.ensureGpuProbe()
    const cliPower = this.gpuProbe ? await this.gpuProbe.sample(now) : { powerW: null, utilPct: null }
    components.gpu = telemetry.gpuPowerW ?? cliPower.powerW
    // GPU utilization: sum of WDDM GPU-engine counters, smoothed with a 10s
    // EMA to match Task Manager's displayed percentage.
    const rawGpuUtil = telemetry.gpuUtilPct ?? cliPower.utilPct
    let gpuUtilPct: number | null = rawGpuUtil
    if (rawGpuUtil != null) {
      const elapsed = this.gpuUtilLastAt ? Math.max(0.25, (now - this.gpuUtilLastAt) / 1000) : 1
      this.gpuUtilLastAt = now
      const alpha = 1 - Math.exp(-elapsed / 10)
      this.gpuUtilLast = rawGpuUtil * alpha + this.gpuUtilLast * (1 - alpha)
      gpuUtilPct = Math.round(this.gpuUtilLast * 10) / 10
    } else {
      this.gpuUtilLast = 0
      this.gpuUtilLastAt = 0
    }

    // Per-process CPU + GPU attribution
    const attributed = await this.attributeProcesses(components.cpu as number, components.gpu, telemetry.gpuConsumers)

    // totalW only counts non-null components
    const totalW = Object.values(components).reduce<number>((s, w) => s + (w ?? 0), 0)
    this.lastTime = now
    return {
      components,
      componentSources: {
        cpu: 'estimated',
        ram: 'estimated',
        disk: 'estimated',
        net: 'estimated',
        gpu: components.gpu != null ? 'measured' : 'unavailable'
      },
      cpuTdpW: this.opts.cpuTDPResolved ? this.opts.cpuTDPWatts : null,
      cpuTdpResolved: this.opts.cpuTDPResolved,
      processes: attributed.samples,
      processCount: attributed.processCount,
      totalW,
      gpuUtilPct,
      gpuTopProcess: telemetry.gpuTopName != null && telemetry.gpuTopPct != null
        ? { name: telemetry.gpuTopName, pct: telemetry.gpuTopPct }
        : null,
      gpuConsumers: telemetry.gpuConsumers,
      cpuLoadPct: this.cpuPctPrimed ? this.cpuPctLast : null,
      memoryUsedBytes: this.memUsedBytes,
      memoryTotalBytes: this.memTotalBytes
    }
  }

  /** Configure the vendor CLI probe from an already-fetched hardware inventory. */
  primeGpuProbe(info: SystemInfo): void {
    this.configureGpuProbe(info.gpus[0] ?? null)
  }

  private async ensureGpuProbe(): Promise<void> {
    if (this.gpuProbeConfigured) return
    try {
      const info = await getSystemInfo()
      this.configureGpuProbe(info.gpus[0] ?? null)
    } catch {
      this.configureGpuProbe(null)
    }
  }

  private configureGpuProbe(gpu: SystemInfo['gpus'][number] | null): void {
    if (this.gpuProbeConfigured) return
    this.gpuProbeConfigured = true
    try {
      this.gpuProbe = new GpuPowerProbe(gpu?.vendorId ?? null, gpu != null)
      console.log(
        '[wattprint] GPU power probe:', gpu ? `${gpu.vendor} ${gpu.model}` : 'no GPU',
        '→', this.gpuProbe.modeName
      )
    } catch {
      this.gpuProbe = new GpuPowerProbe(null, false)
    }
  }

  private async attributeProcesses(
    totalCPUW: number,
    gpuW: number | null,
    gpuConsumers: { name: string; pct: number }[]
  ): Promise<{ samples: ProcessSample[]; processCount: number }> {
    // Prefer the persistent host helper. Retained rows keep serving during a
    // helper restart so the list never blanks; only fall back to
    // systeminformation if the helper has produced no data at all.
    if (this.hostHelper.rows.length > 0 || this.hostHelper.isAlive) {
      const rows = this.hostHelper.rows
      if (rows.length === 0) {
        // Helper is alive but still priming its first snapshot.
        return { samples: [], processCount: 0 }
      }
      const byPid = new Map(rows.map((r) => [r.pid, r]))
      const nowMs = Date.now()
      const elapsed = this.lastAttributionAt ? Math.max(0.25, (nowMs - this.lastAttributionAt) / 1000) : 1
      this.lastAttributionAt = nowMs
      // Task Manager-style 10s EMA smoothing of the instantaneous PerfProc
      // percentages; between helper lines the same values are re-read, so the
      // EMA keeps the display stable (no 0-drops).
      const EMA_SECONDS = 10
      const alpha = 1 - Math.exp(-elapsed / EMA_SECONDS)
      const pending: { pid: number; name: string; pct: number; memoryBytes: number }[] = []
      for (const [pid, row] of byPid) {
        const prev = this.helperPrev.get(pid)
        const rawPct = row.cpuPct ?? 0
        const pct = rawPct * alpha + (prev?.lastPct ?? 0) * (1 - alpha)
        this.helperPrev.set(pid, { lastPct: pct })
        pending.push({ pid, name: row.name, pct, memoryBytes: row.memoryBytes ?? 0 })
      }
      for (const pid of this.helperPrev.keys()) {
        if (!byPid.has(pid)) this.helperPrev.delete(pid)
      }
      // Split the CPU component watts proportionally to each process's share,
      // so the sum of process watts equals the CPU card (no 10W vs 100W gaps).
      const totalPct = pending.reduce((sum, p) => sum + p.pct, 0)
      const out: ProcessSample[] = pending.map((p) => {
        const share = totalPct > 0 ? totalCPUW * (p.pct / totalPct) : 0
        return {
          pid: p.pid,
          name: p.name,
          cpuW: share,
          gpuW: 0,
          w: share,
          cpuPct: this.displayCpuPct(p.pct),
          memoryBytes: p.memoryBytes
        }
      })
      out.sort((a, b) => b.w - a.w)
      const samples = attributeGpuWatts(out, gpuW, gpuConsumers)
      return { samples: samples.slice(0, 1000), processCount: rows.length }
    }

    // Fallback: systeminformation (native Linux or no helper available).
    // Throttled to every 3s — si.processes() spawns `ps`, which we don't
    // want to pay for on every 1s sample.
    const nowMs = Date.now()
    if (!this.fallbackProcs || nowMs - this.fallbackProcsAt >= 3000) {
      try {
        const p = await si.processes()
        this.fallbackProcs = p.list
      } catch {
        // keep the previous listing
      }
      this.fallbackProcsAt = nowMs
    }
    const procs = this.fallbackProcs ?? []
    if (procs.length === 0) return { samples: [], processCount: 0 }
    const pending: { pid: number; name: string; pct: number; memoryBytes: number }[] = []
    for (const p of procs) {
      if (p.pid === 0 || /^system idle process$/i.test(p.name ?? '')) continue
      pending.push({
        pid: p.pid,
        name: p.name ?? `pid ${p.pid}`,
        pct: p.cpu ?? 0,
        memoryBytes: p.memRss ?? 0
      })
    }
    const totalPct = pending.reduce((sum, p) => sum + p.pct, 0)
    const out: ProcessSample[] = pending.map((p) => {
      const share = totalPct > 0 ? totalCPUW * (p.pct / totalPct) : 0
      return {
        pid: p.pid,
        name: p.name,
        cpuW: share,
        gpuW: 0,
        w: share,
        cpuPct: this.displayCpuPct(p.pct),
        memoryBytes: p.memoryBytes
      }
    })
    out.sort((a, b) => b.w - a.w)
    return { samples: out.slice(0, 1000), processCount: procs.length }
  }
  /** Percent of total CPU capacity (100% = all cores), matching Task Manager's Processes tab. */
  private displayCpuPct(perCorePct: number): number {
    const cores = this.logicalCores > 0 ? this.logicalCores : 1
    return Math.round(Math.min(100, perCorePct / cores) * 100) / 100
  }
}

/**
 * Attribute measured GPU watts to processes using the WDDM GPU-engine share
 * reported by the host helper. Each consumer's share is pct / max(Σpct, 100);
 * GPU time no engine accounts for (idle time etc.) is simply not attributed
 * to any app.
 */
export function attributeGpuWatts(
  samples: ProcessSample[],
  gpuW: number | null,
  consumers: { name: string; pct: number }[]
): ProcessSample[] {
  if (gpuW == null || gpuW <= 0 || consumers.length === 0) return samples
  const totalPct = consumers.reduce((sum, c) => sum + c.pct, 0)
  if (totalPct <= 0) return samples
  const denominator = Math.max(totalPct, 100)
  const byName = new Map<string, number>()
  for (const c of consumers) {
    byName.set(c.name.toLowerCase(), c.pct)
  }
  for (const p of samples) {
    const pct = byName.get(p.name.toLowerCase())
    if (pct == null) continue
    p.gpuW = (gpuW * pct) / denominator
  }
  for (const p of samples) p.w = p.cpuW + p.gpuW
  samples.sort((a, b) => b.w - a.w)
  return samples
}

function clamp01(x: number): number {
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

/** Estimate disk watts from throughput in MB/s (saturating model, capped). */
export function estimateDiskWatts(
  mbs: number,
  idle = 3,
  coefficient = 0.01,
  max = MAX_DISK_W
): number {
  return Math.min(idle + coefficient * Math.max(0, mbs), max)
}

/** Estimate network watts from throughput in MB/s (saturating model, capped). */
export function estimateNetWatts(
  mbs: number,
  coefficient = 0.03,
  max = MAX_NET_W
): number {
  return Math.min(coefficient * Math.max(0, mbs), max)
}

/** Estimate RAM watts from used bytes (capped). */
export function estimateRamWatts(
  usedBytes: number,
  per8GB = 3,
  max = MAX_RAM_W
): number {
  return Math.min(per8GB * (usedBytes / (8 * 1024 ** 3)), max)
}
