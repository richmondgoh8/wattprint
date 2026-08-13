// Sleep Mode manager: EcoQoS / Efficiency Mode state machine + session ledger.
// Extracted from Service so the throttling logic is testable in isolation.

import { getSettings } from './config.js'
import { applyEcoBatch, isEcoSupported } from './eco.js'
import { insertSleepSession } from './store.js'
import type { SleepModeState } from '../shared/types.js'

interface EcoProcess {
  pid: number
  name: string
}

const REVERT_DRAIN_MS = 3000

export class SleepModeManager {
  private active = false
  private since = 0
  private baselineW = 0
  private throttled = new Set<number>()
  private lastApplyAt = 0
  private epoch = 0
  private wSum = 0
  private durMs = 0
  private processes: EcoProcess[] = []

  isActive(): boolean {
    return this.active
  }

  state(): SleepModeState {
    return {
      active: this.active,
      supported: isEcoSupported(),
      since: this.active ? new Date(this.since).toISOString() : null,
      baselineW: this.baselineW,
      throttledCount: this.throttled.size
    }
  }

  /** Keep the manager's process view fresh so apply cycles see current PIDs. */
  setProcesses(processes: EcoProcess[]): void {
    this.processes = processes
  }

  /** Enter Sleep Mode against the given idle baseline (W). */
  start(baselineW: number): void {
    // Bump the epoch on any change so in-flight apply cycles from the
    // previous state can't land after the new state took over.
    this.epoch++
    this.active = true
    this.since = Date.now()
    this.baselineW = baselineW
    this.throttled.clear()
    this.wSum = 0
    this.durMs = 0
    this.lastApplyAt = 0
    this.applyEco().catch(() => {
      // best-effort: retried on the next cycle
    })
  }

  /** Record the session, then restore performance with a retry for failures. */
  async finish(): Promise<void> {
    if (!this.active) return
    this.active = false
    this.epoch++
    const toRevert = [...this.throttled]
    this.recordSession(toRevert.length)
    await this.revertWithRetry(toRevert)
  }

  /** Quit-time variant: record the session, then bound the revert so the
   *  main process never hangs on shutdown. EcoQoS dies with the process
   *  anyway, so a drained revert is a best-effort courtesy. */
  async finishBounded(): Promise<void> {
    if (!this.active) return
    this.active = false
    const toRevert = [...this.throttled]
    this.recordSession(toRevert.length)
    if (toRevert.length === 0) return
    await Promise.race([this.revertWithRetry(toRevert), sleep(REVERT_DRAIN_MS)])
  }

  /** Per-tick accumulation + periodic (re)apply of throttling. */
  tick(now: number, dtMs: number, totalW: number): void {
    if (!this.active) return
    this.durMs += dtMs
    this.wSum += totalW * dtMs
    if (now - this.lastApplyAt > 60_000) {
      this.lastApplyAt = now
      this.applyEco().catch(() => {
        // best-effort: retried on the next cycle
      })
    }
  }

  /** Eco-throttle all non-whitelisted processes that aren't throttled yet. */
  private async applyEco(): Promise<void> {
    if (!this.active) return
    const epoch = this.epoch
    const whitelist = new Set(getSettings().sleepMode.whitelist)
    const byPid = new Map<number, string>()
    for (const p of this.processes) {
      if (p.pid > 0) byPid.set(p.pid, p.name)
    }
    for (const pid of this.throttled) {
      if (!byPid.has(pid)) this.throttled.delete(pid)
    }
    const pids: number[] = []
    for (const [pid, name] of byPid) {
      if (whitelist.has(name.toLowerCase())) continue
      if (this.throttled.has(pid)) continue
      pids.push(pid)
    }
    if (pids.length === 0) return
    const res = await applyEcoBatch(pids, true)
    // Re-check after the await: if Sleep Mode ended (or restarted) while the
    // PowerShell call was in flight, don't record these pids — the exit path
    // owns their state now and would not have reverted unknown pids.
    if (!this.active || this.epoch !== epoch) return
    for (const pid of pids) {
      if (!res.failedPids.has(pid)) this.throttled.add(pid)
    }
  }

  private async revertWithRetry(pids: number[]): Promise<void> {
    if (pids.length === 0) return
    let toRevert = pids
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await applyEcoBatch(toRevert, false)
      if (res.failedPids.size === 0) return
      toRevert = [...res.failedPids]
    }
  }

  private recordSession(throttledCount: number): void {
    if (this.since <= 0) return
    const end = Date.now()
    const hours = this.durMs / 3600000
    if (hours >= 1 / 60) {
      const avgW = this.durMs > 0 ? this.wSum / this.durMs : 0
      const baselineW = this.baselineW
      const kwh = (avgW * hours) / 1000
      const savedKwh = Math.max(0, (baselineW - avgW) * hours) / 1000
      try {
        insertSleepSession(this.since, end, avgW, baselineW, kwh, savedKwh, throttledCount)
      } catch {
        // best-effort
      }
    }
    this.since = 0
    this.wSum = 0
    this.durMs = 0
    this.baselineW = 0
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
