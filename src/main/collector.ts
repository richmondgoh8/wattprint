// Per-second system power sampler.
// v0.1 estimation model (replaceable later with NVML/Intel-RAPL where possible):
//   - CPU:    TDP × cpu%
//   - GPU:    5W integrated / 25W discrete idle (heuristic — no real cross-platform util signal)
//   - RAM:    ~3 W per 8 GB used
//   - Disk:   3 W idle + 1 W per MB/s
//   - Network: 0.5 W per MB/s
// Per-process attribution distributes CPU watts by CPU% share.

import * as si from 'systeminformation'
import type { ProcessSample } from '../shared/types.js'

export interface CollectorOptions {
  cpuTDPWatts: number
  gpuIdleWattsIntegrated: number
  gpuIdleWattsDiscrete: number
  ramWattsPer8GB: number
  diskIdleWatts: number
  diskActiveWattsPerMBs: number
  netWattsPerMBs: number
}

const DEFAULTS: CollectorOptions = {
  cpuTDPWatts: 95,
  gpuIdleWattsIntegrated: 5,
  gpuIdleWattsDiscrete: 25,
  ramWattsPer8GB: 3,
  diskIdleWatts: 3,
  diskActiveWattsPerMBs: 1,
  netWattsPerMBs: 0.5
}

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
  processes: ProcessSample[]
  totalW: number
  gpuHasSensor: boolean
  gpuHeuristicIdle: number
}

export class Collector {
  private opts: CollectorOptions
  private cpuPctLast = 0
  private cpuPctPrimed = false
  private lastTime = 0
  private prevNet: NetPrev | null = null
  private prevDisk = new Map<string, DiskPrev>()
  // GPU detection is computed once on first sample.
  private gpuDetected: { hasDiscrete: boolean; hasIntegrated: boolean } | null = null

  constructor(opts: Partial<CollectorOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts }
  }

  async sample(): Promise<SystemSnapshot> {
    const now = Date.now()
    const dt = this.lastTime === 0 ? 0 : (now - this.lastTime) / 1000
    const components: Record<string, number | null> = {}

    // CPU
    try {
      const load = await si.currentLoad()
      if (load.currentLoad > 0) {
        this.cpuPctLast = load.currentLoad
        this.cpuPctPrimed = true
      }
    } catch {
      // ignore
    }
    components.cpu = this.cpuPctPrimed ? this.opts.cpuTDPWatts * clamp01(this.cpuPctLast / 100) : 0

    // RAM
    try {
      const mem = await si.mem()
      components.ram = this.opts.ramWattsPer8GB * (mem.used / (8 * 1024 ** 3))
    } catch {
      components.ram = 0
    }

    // Disk
    let diskW = this.opts.diskIdleWatts
    if (dt > 0) {
      try {
        const fs = await si.fsStats()
        let bytesPerSec = 0
        if (fs.rx_sec != null && fs.wx_sec != null) {
          bytesPerSec = (fs.rx_sec || 0) + (fs.wx_sec || 0)
        } else if (this.prevDisk.has('*')) {
          const prev = this.prevDisk.get('*')!
          const drx = Math.max(0, (fs.rx || 0) - prev.rx)
          const dwx = Math.max(0, (fs.wx || 0) - prev.wx)
          bytesPerSec = (drx + dwx) / dt
        }
        this.prevDisk.set('*', { rx: fs.rx || 0, wx: fs.wx || 0 })
        const mbs = bytesPerSec / (1024 * 1024)
        diskW += this.opts.diskActiveWattsPerMBs * mbs
      } catch {
        // ignore
      }
    }
    components.disk = diskW

    // Network
    let netW = 0
    if (dt > 0) {
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
          netW = this.opts.netWattsPerMBs * mbs
        }
        this.prevNet = cur
      } catch {
        // ignore
      }
    }
    components.net = netW

    // GPU: detect once, then apply heuristic idle. v0.1 has no real cross-platform
    // util signal (systeminformation.graphics doesn't expose %); NVML lands later.
    const gpu = await this.detectGpu()
    let gpuW: number | null = 0
    let gpuHeuristicIdle = 0
    if (!gpu.hasDiscrete && !gpu.hasIntegrated) {
      gpuW = null // no GPU detected at all
    } else {
      gpuHeuristicIdle = gpu.hasDiscrete
        ? this.opts.gpuIdleWattsDiscrete
        : this.opts.gpuIdleWattsIntegrated
      gpuW = gpuHeuristicIdle
    }
    components.gpu = gpuW

    // Per-process CPU attribution
    const processes = await this.attributeProcesses(components.cpu as number)

    // totalW only counts non-null components
    const totalW = Object.values(components).reduce<number>((s, w) => s + (w ?? 0), 0)
    this.lastTime = now
    return {
      components,
      processes,
      totalW,
      gpuHasSensor: false, // v0.1: never have a real sensor
      gpuHeuristicIdle
    }
  }

  private async detectGpu(): Promise<{ hasDiscrete: boolean; hasIntegrated: boolean }> {
    if (this.gpuDetected) return this.gpuDetected
    let hasDiscrete = false
    let hasIntegrated = false
    try {
      const g = await si.graphics()
      for (const c of g.controllers ?? []) {
        if (c.vendor?.toLowerCase().includes('intel')) hasIntegrated = true
        else if (c.vendor) hasDiscrete = true
      }
    } catch {
      // ignore
    }
    this.gpuDetected = { hasDiscrete, hasIntegrated }
    return this.gpuDetected
  }

  private async attributeProcesses(totalCPUW: number): Promise<ProcessSample[]> {
    let procs: si.Systeminformation.ProcessesProcessData[]
    try {
      const p = await si.processes()
      procs = p.list
    } catch {
      return []
    }
    const out: ProcessSample[] = []
    for (const p of procs) {
      if (totalCPUW <= 0) continue
      const pct = p.cpu ?? 0
      if (pct <= 0) continue
      const share = (pct / 100) * totalCPUW
      out.push({
        pid: p.pid,
        name: p.name ?? `pid ${p.pid}`,
        cpuW: share,
        gpuW: 0,
        w: share
      })
    }
    out.sort((a, b) => b.w - a.w)
    return out.slice(0, 100)
  }
}

function clamp01(x: number): number {
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}
