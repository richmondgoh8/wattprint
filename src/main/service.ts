// Service: orchestrates the sampling loop and hourly rollup loop.
// Emits snapshots to the renderer via ipcMain.webContents.send.

import { BrowserWindow } from 'electron'
import { Collector } from './collector.js'
import { getSettings } from './config.js'
import { writeSamples, rollupHour, totalsByKey, hourlyByKey } from './store.js'
import type { Snapshot, KeyTotal, HourlyRollup, SystemInfo } from '../shared/types.js'
import { compute as forecastCompute, type ForecastResult } from './forecast.js'
import * as si from 'systeminformation'

export class Service {
  private collector = new Collector()
  private sampleTimer: NodeJS.Timeout | null = null
  private rollupTimer: NodeJS.Timeout | null = null
  private started = false
  private getWindow: () => BrowserWindow | null

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.emitStatus('starting…')

    // Prime the first sample (CPU% is 0 on first call)
    this.tick().catch((e) => this.emitStatus('sample error: ' + e))

    const interval = Math.max(1, getSettings().sampleIntervalSeconds) * 1000
    this.sampleTimer = setInterval(() => {
      this.tick().catch((e) => this.emitStatus('sample error: ' + e))
    }, interval)

    // Roll up the just-completed hour (if Wattprint was off for a while)
    this.rollupPreviousHour()

    // Check every 15 minutes
    this.rollupTimer = setInterval(() => this.maybeRollup(), 15 * 60 * 1000)
  }

  stop(): void {
    if (this.sampleTimer) clearInterval(this.sampleTimer)
    if (this.rollupTimer) clearInterval(this.rollupTimer)
    this.sampleTimer = null
    this.rollupTimer = null
    this.started = false
  }

  private async tick(): Promise<void> {
    const snap = await this.collector.sample()
    const snapshot: Snapshot = {
      ts: new Date().toISOString(),
      components: snap.components,
      processes: snap.processes,
      totalW: snap.totalW
    }
    this.persist(snap)
    this.emitSample(snapshot)
  }

  private persist(snap: { components: Record<string, number | null>; processes: { pid: number; name: string; cpuW: number; gpuW: number; w: number }[]; totalW: number }): void {
    const ts = new Date()
    const samples: { ts: Date; scope: 'component' | 'process'; key: string; watts: number }[] = []
    for (const [key, watts] of Object.entries(snap.components)) {
      if (watts == null) continue
      samples.push({ ts, scope: 'component', key, watts })
    }
    for (const p of snap.processes) {
      if (p.w <= 0) continue
      samples.push({ ts, scope: 'process', key: p.name, watts: p.w })
    }
    try {
      writeSamples(samples)
    } catch (e) {
      this.emitStatus('store error: ' + e)
    }
  }

  private maybeRollup(): void {
    const now = new Date()
    if (now.getMinutes() < 5) this.rollupPreviousHour()
  }

  private rollupPreviousHour(): void {
    const hour = new Date()
    hour.setUTCMinutes(0, 0, 0)
    try {
      rollupHour(hour)
    } catch (e) {
      this.emitStatus('rollup error: ' + e)
    }
  }

  // ---- Queries (called by IPC handlers) ----

  viewTotals(from: Date, to: Date, scope: string): KeyTotal[] {
    return totalsByKey(from, to, scope)
  }

  viewHourly(from: Date, to: Date, scope: string, key: string): HourlyRollup[] {
    return hourlyByKey(from, to, scope, key)
  }

  viewForecast(): ForecastResult {
    const s = getSettings()
    return forecastCompute(s.forecastWindowDays, s.costPerKWh, s.gridCarbonIntensity, s.currency)
  }

  async viewSystemInfo(): Promise<SystemInfo> {
    const [cpu, mem, g, os] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.graphics(),
      si.osInfo()
    ])
    return {
      cpu: {
        brand: cpu.brand,
        manufacturer: cpu.manufacturer,
        cores: cpu.cores,
        physicalCores: cpu.physicalCores,
        speedGHz: cpu.speed
      },
      memoryTotalBytes: mem.total,
      gpus: (g.controllers ?? []).map((c) => ({
        vendor: c.vendor ?? 'Unknown',
        model: c.model ?? 'Unknown',
        vram: c.vram ?? null
      })),
      os: {
        platform: process.platform,
        release: os.release,
        hostname: os.hostname
      }
    }
  }

  // ---- Emitters ----

  private emitStatus(msg: string): void {
    const w = this.getWindow()
    if (w && !w.isDestroyed()) w.webContents.send('wattprint:status', msg)
  }

  private emitSample(s: Snapshot): void {
    const w = this.getWindow()
    if (w && !w.isDestroyed()) w.webContents.send('wattprint:sample', s)
  }
}
