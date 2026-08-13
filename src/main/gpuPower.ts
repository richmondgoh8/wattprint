// Real GPU power + utilization via vendor CLIs, never estimated.
//   NVIDIA: nvidia-smi.exe ships with every NVIDIA driver (no install).
//   AMD:    amd-smi.exe (official AMD SMI CLI, optional install).
// Polled at a low cadence (5s) and cached; failures keep the last value
// or null (shown as "—" in the UI).

import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface GpuPowerSample {
  powerW: number | null
  utilPct: number | null
}

const POLL_MS = 5000
const CMD_TIMEOUT_MS = 5000

export class GpuPowerProbe {
  private mode: 'nvidia' | 'amd' | 'off' = 'off'
  private amdPath: string | null = null
  private lastSampleAt = 0
  private cached: GpuPowerSample = { powerW: null, utilPct: null }

  constructor(vendorId: string | null | undefined, hasGpu: boolean) {
    if (!hasGpu) return
    const id = (vendorId ?? '').toLowerCase().replace(/^0x/, '')
    if (id === '10de') this.mode = 'nvidia'
    else if (id === '1002') this.mode = 'amd'
  }

  get modeName(): string {
    return this.mode
  }

  async sample(now = Date.now()): Promise<GpuPowerSample> {
    if (this.mode === 'off') return this.cached
    if (now - this.lastSampleAt < POLL_MS) return this.cached
    this.lastSampleAt = now
    try {
      if (this.mode === 'nvidia') this.cached = await this.probeNvidia()
      else this.cached = await this.probeAmd()
    } catch {
      // keep the previous value (or null) until the next poll
    }
    return this.cached
  }

  private async probeNvidia(): Promise<GpuPowerSample> {
    const { stdout } = await execFileAsync(
      'nvidia-smi.exe',
      ['--query-gpu=power.draw,utilization.gpu', '--format=csv,noheader,nounits'],
      { timeout: CMD_TIMEOUT_MS, windowsHide: true }
    )
    const parts = stdout.trim().split(/[\n,]/).map((s) => s.trim())
    const powerW = Number.parseFloat(parts[0] ?? '')
    const utilPct = Number.parseFloat(parts[1] ?? '')
    if (!Number.isFinite(powerW) || !Number.isFinite(utilPct)) return this.cached
    return { powerW, utilPct }
  }

  private async probeAmd(): Promise<GpuPowerSample> {
    if (!this.amdPath) {
      this.amdPath = findAmdSmi()
      if (!this.amdPath) {
        try {
          await execFileAsync('amd-smi.exe', ['--version'], { timeout: CMD_TIMEOUT_MS, windowsHide: true })
          this.amdPath = 'amd-smi.exe'
        } catch {
          this.mode = 'off'
          return this.cached
        }
      }
    }
    try {
      const { stdout } = await execFileAsync(this.amdPath, ['monitor', '--json'], {
        timeout: CMD_TIMEOUT_MS,
        windowsHide: true
      })
      const parsed: unknown = JSON.parse(stdout)
      const root = parsed as Record<string, unknown>
      const gpuArray = root['gpu']
      if (Array.isArray(gpuArray) && gpuArray.length > 0) {
        const first = gpuArray[0] as Record<string, unknown>
        const power = (first['power'] ?? first['Power']) as Record<string, unknown> | undefined
        const util = (first['utilization'] ?? first['Utilization']) as Record<string, unknown> | undefined
        const powerW = Number.parseFloat(String((power?.['instantaneous'] ?? power?.['Instantaneous']) ?? ''))
        const utilPct = Number.parseFloat(String((util?.['gpu'] ?? util?.['Gpu']) ?? ''))
        if (Number.isFinite(powerW) && Number.isFinite(utilPct)) return { powerW, utilPct }
      }
    } catch {
      // fall through to plain monitor output
    }
    try {
      const { stdout } = await execFileAsync(this.amdPath, ['monitor'], {
        timeout: CMD_TIMEOUT_MS,
        windowsHide: true
      })
      const line = stdout.split('\n').find((l) => /W\s/.test(l) && /%/.test(l))
      if (line) {
        const powerW = Number.parseFloat(line.match(/([\d.]+)\s*W/)?.[1] ?? '')
        const utilPct = Number.parseFloat(line.match(/([\d.]+)\s*%/)?.[1] ?? '')
        if (Number.isFinite(powerW) && Number.isFinite(utilPct)) return { powerW, utilPct }
      }
    } catch {
      // keep previous value
    }
    return this.cached
  }
}

/** Search common AMD install locations for amd-smi.exe (shallow walk). */
function findAmdSmi(): string | null {
  const roots = [
    'C:\\Program Files\\AMD',
    'C:\\Program Files (x86)\\AMD',
    'C:\\Program Files\\AMD Software'
  ]
  const exe = 'amd-smi.exe'
  const visited = new Set<string>()
  const queue: { dir: string; depth: number }[] = roots.map((dir) => ({ dir, depth: 0 }))
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!
    if (depth > 3 || visited.has(dir)) continue
    visited.add(dir)
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      if (entry.toLowerCase() === exe && existsSync(full)) return full
      if (depth < 3) queue.push({ dir: full, depth: depth + 1 })
    }
  }
  return null
}
