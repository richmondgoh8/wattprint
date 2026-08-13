// Service: orchestrates the sampling loop and hourly rollup loop.
// Emits snapshots to the renderer via ipcMain.webContents.send.

import { BrowserWindow, app } from 'electron'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { Collector } from './collector.js'
import { getSettings } from './config.js'
import {
  getReadiness as getStoreReadiness,
  pruneSamples,
  pruneMachineStates,
  writeSamples,
  rollupMissingHours,
  machineStateRange,
  sleepSessions,
  trackingCoverage
} from './store.js'
import { StateLedger } from './ledger.js'
import { SleepModeManager } from './sleepMode.js'
import { isEcoSupported } from './eco.js'
import type { Snapshot, KeyTotal, Readiness, SystemInfo, MachineStateRow, Insights, SleepSession, Benchmark, TrackingInfo } from '../shared/types.js'
import { compute as forecastCompute, type ForecastResult } from './forecast.js'
import { compute as insightsCompute } from './insights.js'
import { benchmarkCompute } from './benchmarks.js'
import { getSystemInfo } from './hardware.js'
import { runQuery, type QueryArgs, type QueryKind } from './queries.js'

const STATE_PRUNE_DAYS = 30

export class Service {
  private collector = new Collector()
  private sampleTimer: NodeJS.Timeout | null = null
  private rollupTimer: NodeJS.Timeout | null = null
  private started = false
  private startedAt: Date | null = null
  private currentStatus = 'initializing…'
  private currentProcessCount = 0
  private sampleIntervalSeconds = 1
  private lastProcessPersistAt = Date.now()
  private firstSampleEmitted = false
  private monitoringEmitted = false
  private getWindow: () => BrowserWindow | null
  private onTraySample: ((s: Snapshot) => void) | null
  private lastTickAt = 0
  private ticking = false
  private lastProcesses: Snapshot['processes'] = []
  private ledger = new StateLedger(() => this.sampleIntervalSeconds)
  private sleep = new SleepModeManager()
  // Query worker thread (heavy reads run off the main thread)
  private dbWorker: Worker | null = null
  private workerPending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  private workerSeq = 0

  constructor(getWindow: () => BrowserWindow | null, onTraySample?: (s: Snapshot) => void, dbDir?: string) {
    this.getWindow = getWindow
    this.onTraySample = onTraySample ?? null
    if (dbDir) this.startDbWorker(dbDir)
  }

  /** Start the query worker; falls back to inline queries if it fails. */
  private startDbWorker(dbDir: string): void {
    try {
      const worker = new Worker(join(import.meta.dirname, 'dbWorker.js'), {
        workerData: { dbDir }
      })
      worker.unref()
      worker.on('message', (msg: { id: number; ok: boolean; result?: unknown; error?: string }) => {
        const pending = this.workerPending.get(msg.id)
        if (!pending) return
        this.workerPending.delete(msg.id)
        clearTimeout(pending.timer)
        if (msg.ok) pending.resolve(msg.result)
        else pending.reject(new Error(msg.error ?? 'worker query failed'))
      })
      worker.on('error', (err) => {
        this.failWorkerPending(err)
        this.dbWorker = null
        try {
          void worker.terminate()
        } catch {
          // best-effort
        }
      })
      this.dbWorker = worker
    } catch {
      this.dbWorker = null
    }
  }

  private failWorkerPending(err: Error): void {
    for (const [, pending] of this.workerPending) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.workerPending.clear()
  }

  /** Run a read query on the worker; fall back to inline on any failure. */
  private query<T>(kind: QueryKind, args: QueryArgs, fallback: () => T): Promise<T> {
    if (this.dbWorker) {
      const id = ++this.workerSeq
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this.workerPending.has(id)) {
            this.workerPending.delete(id)
            reject(new Error('query timeout'))
          }
        }, 20_000)
        timer.unref()
        this.workerPending.set(id, {
          resolve: (v) => resolve(v as T),
          reject,
          timer
        })
        this.dbWorker?.postMessage({ id, kind, args })
      }).catch((err) => {
        // Fail over permanently on timeout or crash: a hung worker would
        // otherwise stall every query for 20s before falling back each time,
        // and heavy inline queries must not run repeatedly on the main thread.
        if (this.dbWorker) {
          try {
            void this.dbWorker.terminate()
          } catch {
            // best-effort
          }
          this.dbWorker = null
          this.failWorkerPending(err)
        }
        return fallback()
      })
    }
    return Promise.resolve(fallback())
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.startedAt = new Date()
    this.emitStatus('starting…')

    // Start the persistent host-process probe before the first sample.
    this.collector.setLhmDir(this.resolveLhmDir())
    this.collector.start()
    this.collector.setPollMs(this.sampleIntervalSeconds * 1000)

    // Resolve the real CPU reference TDP asynchronously; keep the 95 W
    // default until it lands so the first samples are never blocked.
    this.primeCollector().catch(() => {
      // keep defaults
    })

    // Prime the first sample (CPU% is 0 on first call)
    this.tick().catch((e) => this.emitStatus('sample error: ' + e))

    this.scheduleSampleTimer()
    this.startStateTracking()

    // Catch-up rollup + prune run shortly after the window is up, never
    // synchronously at startup. The catch-up covers every hour with raw
    // samples but no rollup yet (e.g. the previous session's trailing
    // partial hour), so no measured energy can age into the prune window
    // un-rolled. The 15-minute timer keeps things bounded after.
    setTimeout(() => {
      try {
        rollupMissingHours()
      } catch (e) {
        this.emitStatus('rollup error: ' + e)
      }
    }, 300)
    setTimeout(() => {
      pruneSamples(Math.floor(Date.now() / 1000) - 48 * 3600).catch(() => {
        // prune is best-effort
      })
    }, 1000)

    // Check every 15 minutes
    this.rollupTimer = setInterval(() => this.maybeRollup(), 15 * 60 * 1000)
  }

  private async primeCollector(): Promise<void> {
    try {
      const info = await getSystemInfo()
      const tdp = info.cpu.tdpW
      this.collector.setCpuTdp(tdp != null && tdp > 0 ? tdp : 95, tdp != null && tdp > 0)
      // Configure the GPU power probe here too so the first sample never
      // blocks on the hardware inventory query.
      this.collector.primeGpuProbe(info)
    } catch {
      // keep defaults
    }
  }

  private startStateTracking(): void {
    this.ledger.init()
  }

  reloadSettings(): void {
    if (!this.started) return
    this.sampleIntervalSeconds = Math.max(1, getSettings().sampleIntervalSeconds)
    this.collector.setPollMs(this.sampleIntervalSeconds * 1000)
    this.scheduleSampleTimer()
  }

  private resolveLhmDir(): string | null {
    try {
      const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
      const dir = join(base, 'lhm')
      if (!existsSync(join(dir, 'LibreHardwareMonitorLib.dll'))) return null
      if (process.platform === 'win32') return dir
      // WSL dev: .NET cannot load assemblies from \\wsl.localhost shares, so
      // copy the DLLs into the Windows temp dir once and point there.
      const winTemp = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', '[IO.Path]::GetTempPath()'],
        { encoding: 'utf8' }
      ).trim()
      const targetWin = join(winTemp, 'wattprint-lhm')
      const targetLinux = execFileSync('wslpath', ['-u', targetWin], { encoding: 'utf8' }).trim()
      mkdirSync(targetLinux, { recursive: true })
      cpSync(dir, targetLinux, { recursive: true, force: true })
      return targetWin
    } catch {
      return null
    }
  }

  private scheduleSampleTimer(): void {
    if (this.sampleTimer) clearInterval(this.sampleTimer)
    this.sampleIntervalSeconds = Math.max(1, getSettings().sampleIntervalSeconds)
    this.sampleTimer = setInterval(() => {
      this.tick().catch((e) => this.emitStatus('sample error: ' + e))
    }, this.sampleIntervalSeconds * 1000)
  }

  /** Stop sampling loops and drains in-flight cleanup; bounded, never blocks
   *  the main process for long. */
  async stop(): Promise<void> {
    if (this.sampleTimer) clearInterval(this.sampleTimer)
    if (this.rollupTimer) clearInterval(this.rollupTimer)
    this.sampleTimer = null
    this.rollupTimer = null
    this.started = false
    this.startedAt = null
    // Bounded async revert so quitting mid-Sleep-Mode never leaves apps
    // throttled and never freezes shutdown.
    await this.sleep.finishBounded()
    this.ledger.finalize(Date.now())
    this.collector.stop()
    try {
      this.dbWorker?.terminate()
    } catch {
      // best-effort
    }
    this.dbWorker = null
  }

  private async tick(): Promise<void> {
    // Guard against overlapping ticks: sample() awaits child processes and
    // can exceed the interval; overlapping runs would double-count energy
    // and write duplicate rows. Dropping a sample is the right trade.
    if (this.ticking) return
    this.ticking = true
    try {
      const snap = await this.collector.sample()
      const now = Date.now()
      const sleepMode = this.sleep.state()
      const snapshot: Snapshot = {
        ts: new Date(now).toISOString(),
        components: snap.components,
        componentSources: snap.componentSources,
        cpuTdpW: snap.cpuTdpW,
        cpuTdpResolved: snap.cpuTdpResolved,
        sleepMode,
        processes: snap.processes,
        processCount: snap.processCount,
        gpuUtilPct: snap.gpuUtilPct,
        gpuTopProcess: snap.gpuTopProcess,
        gpuConsumers: snap.gpuConsumers,
        cpuLoadPct: snap.cpuLoadPct,
        memoryUsedBytes: snap.memoryUsedBytes,
        memoryTotalBytes: snap.memoryTotalBytes,
        totalW: snap.totalW
      }
      this.currentProcessCount = snap.processCount
      this.lastProcesses = snap.processes
      this.sleep.setProcesses(snap.processes)
      const dtMs = this.lastTickAt > 0 ? now - this.lastTickAt : this.sampleIntervalSeconds * 1000
      this.lastTickAt = now
      this.ledger.track(snap.totalW, now)
      this.sleep.tick(now, dtMs, snap.totalW)
      this.persist(snap)
      this.emitSample(snapshot)
      this.onTraySample?.(snapshot)
      this.updateStatus(snap.processCount)
    } finally {
      this.ticking = false
    }
  }

  // ---- Sleep Mode ----

  isSleepModeActive(): boolean {
    return this.sleep.isActive()
  }

  async setSleepMode(on: boolean): Promise<void> {
    if (on === this.sleep.isActive()) return
    if (on && !isEcoSupported()) return
    if (on) {
      this.sleep.start(this.idleBaselineW())
    } else {
      await this.sleep.finish()
    }
  }

  viewSleepSessions(from: Date, to: Date): Promise<SleepSession[]> {
    return this.query(
      'sleepSessions',
      { from: from.toISOString(), to: to.toISOString() },
      () => sleepSessions(from, to)
    )
  }

  /** Weighted average watts of idle/screen-off segments over the last 7 days. */
  private idleBaselineW(): number {
    try {
      const from = new Date(Date.now() - 7 * 24 * 3600 * 1000)
      const rows = machineStateRange(from, new Date())
      let wSum = 0
      let hSum = 0
      for (const r of rows) {
        if (r.state !== 'idle' && r.state !== 'screen-off') continue
        const hours = (new Date(r.to).getTime() - new Date(r.from).getTime()) / 3600000
        wSum += r.avgW * hours
        hSum += hours
      }
      return hSum > 0 ? wSum / hSum : 0
    } catch {
      return 0
    }
  }

  private updateStatus(processCount: number): void {
    if (!this.firstSampleEmitted) {
      this.firstSampleEmitted = true
      console.log(
        '[wattprint] startup: first sample in',
        Date.now() - (this.startedAt?.getTime() ?? Date.now()),
        'ms'
      )
      this.emitStatus('collecting live data…')
      return
    }
    if (processCount > 0 && !this.monitoringEmitted) {
      this.monitoringEmitted = true
      this.emitStatus(`monitoring · ${processCount} processes`)
    }
  }

  private persist(snap: { components: Record<string, number | null>; processes: { pid: number; name: string; cpuW: number; gpuW: number; w: number }[]; totalW: number }): void {
    const ts = new Date()
    const samples: { ts: Date; scope: 'component' | 'process'; key: string; watts: number; gpuW?: number; intervalSeconds?: number }[] = []
    for (const [key, watts] of Object.entries(snap.components)) {
      if (watts == null) continue
      samples.push({ ts, scope: 'component', key, watts })
    }
    // Process history is throttled to every 5s to keep disk and query load low.
    // Each process row must carry the actual elapsed interval (not the 1s
    // component interval), or kWh/minutes get undercounted ~5x. The interval
    // is capped at 10 min: anything larger is a sleep/resume gap, and a
    // machine that was asleep wasn't tracking.
    const nowMs = Date.now()
    const processInterval = nowMs - this.lastProcessPersistAt
    if (processInterval >= 5000) {
      this.lastProcessPersistAt = nowMs
      const intervalSeconds = Math.max(1, Math.min(600, Math.round(processInterval / 1000)))
      for (const p of snap.processes) {
        if (p.w <= 0) continue
        samples.push({ ts, scope: 'process', key: p.name, watts: p.w, gpuW: p.gpuW, intervalSeconds })
      }
    }
    try {
      writeSamples(samples, this.sampleIntervalSeconds)
    } catch (e) {
      this.emitStatus('store error: ' + e)
    }
  }

  private maybeRollup(): void {
    try {
      // Self-healing: roll every hour that has samples but no rollup yet,
      // not just the previous one.
      rollupMissingHours()
    } catch (e) {
      this.emitStatus('rollup error: ' + e)
    }
    pruneSamples(Math.floor(Date.now() / 1000) - 48 * 3600).catch(() => {
      // prune is best-effort
    })
    pruneMachineStates(Math.floor(Date.now() / 1000) - STATE_PRUNE_DAYS * 24 * 3600).catch(() => {
      // prune is best-effort
    })
  }

  // ---- Queries (called by IPC handlers; run on the worker thread) ----

  viewTotals(from: Date, to: Date, scope: string): Promise<KeyTotal[]> {
    return this.query(
      'totals',
      { from: from.toISOString(), to: to.toISOString(), scope },
      () => runQuery('totals', { from: from.toISOString(), to: to.toISOString(), scope }) as KeyTotal[]
    )
  }

  viewForecast(): Promise<ForecastResult> {
    const s = getSettings()
    return this.query(
      'forecast',
      { costPerKWh: s.costPerKWh, currency: s.currency },
      () => forecastCompute(s.costPerKWh, s.currency)
    )
  }

  async viewSystemInfo(): Promise<SystemInfo> {
    return getSystemInfo()
  }

  viewMachineStates(from: Date, to: Date): Promise<MachineStateRow[]> {
    return this.query(
      'machineStates',
      { from: from.toISOString(), to: to.toISOString() },
      () => machineStateRange(from, to)
    )
  }

  viewInsights(): Promise<Insights> {
    const s = getSettings()
    return this.query('insights', { settings: s }, () => insightsCompute(s))
  }

  viewTrackingInfo(fromIso?: string | null): Promise<TrackingInfo> {
    const args: Record<string, unknown> = { liveState: this.ledger.currentState }
    if (fromIso) args.from = fromIso
    return this.query('trackingInfo', args, () =>
      trackingCoverage(
        fromIso ? Math.floor(new Date(fromIso).getTime() / 1000) : undefined,
        this.ledger.currentState
      )
    )
  }

  viewBenchmark(): Promise<Benchmark> {
    const s = getSettings()
    return this.query(
      'benchmark',
      { settings: s, liveState: this.ledger.currentState },
      () => benchmarkCompute(s, this.ledger.currentState)
    )
  }

  // ---- Emitters ----

  private emitStatus(msg: string): void {
    this.currentStatus = msg
    const w = this.getWindow()
    if (w && !w.isDestroyed()) w.webContents.send('wattprint:status', msg)
  }

  private emitSample(s: Snapshot): void {
    const w = this.getWindow()
    if (w && !w.isDestroyed()) w.webContents.send('wattprint:sample', s)
  }

  async getReadiness(): Promise<Readiness> {
    const data = await this.query(
      'readiness',
      { windowDays: 30 },
      () => getStoreReadiness(30)
    )
    const now = Date.now()
    const hour = Math.floor(now / 3600000) * 3600000
    const nextBoundary = hour + 3600000
    const pollInterval = 15 * 60 * 1000
    const startedAt = this.startedAt?.getTime() ?? now
    const sinceStart = Math.max(0, nextBoundary - startedAt)
    const nextPollOffset = (pollInterval - (sinceStart % pollInterval)) % pollInterval
    return {
      status: this.currentProcessCount > 0
        ? `monitoring · ${this.currentProcessCount} processes`
        : this.currentStatus,
      processCount: this.currentProcessCount,
      startedAt: this.startedAt?.toISOString() ?? null,
      lastSampleAt: data.latestSampleAt == null ? null : new Date(data.latestSampleAt * 1000).toISOString(),
      lastHourlyRollupAt: data.latestHourlyRollupAt == null ? null : new Date(data.latestHourlyRollupAt * 1000).toISOString(),
      nextHourlyDataAt: new Date(nextBoundary + nextPollOffset).toISOString(),
      sampleIntervalSeconds: Math.max(1, getSettings().sampleIntervalSeconds),
      hourlyBucketsAvailable: data.hourlyBucketsAvailable,
      forecastBucketsRequired: 6,
      processSamplesAvailable: data.processSamplesAvailable
    }
  }
}
