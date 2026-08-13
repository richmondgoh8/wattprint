// Machine-state ledger: splits measured energy into active / idle /
// screen-off / sleep / off segments, persisted to SQLite.

import { powerMonitor } from 'electron'
import { insertMachineState, lastMachineStateEnd } from './store.js'
import type { MachineState } from '../shared/types.js'

const IDLE_MS = 2 * 60 * 1000
const SCREEN_OFF_MS = 5 * 60 * 1000

export class StateLedger {
  private state: MachineState = 'active'
  private stateFrom = 0
  private stateDurMs = 0
  private stateWSum = 0
  private stateKWh = 0
  private lastTickAt = 0
  private idleSeconds = 0
  private lastIdleCheckAt = 0

  constructor(private readonly sampleIntervalSeconds: () => number) {
    powerMonitor.on('suspend', () => this.onSuspend())
    powerMonitor.on('resume', () => this.onResume())
  }

  /** The state of the segment currently in progress (not yet flushed). */
  get currentState(): MachineState {
    return this.state
  }

  /** Seed the ledger: mark the machine "off" between the last recorded
   *  segment and now, unless the gap is tiny (quick restart). */
  init(): void {
    const last = lastMachineStateEnd()
    const now = Date.now()
    if (last != null && now - last * 1000 > 5 * 60 * 1000) {
      try {
        insertMachineState(last * 1000, now, 'off', 0, 0)
      } catch {
        // best-effort
      }
    }
    this.stateFrom = now
  }

  /** Track machine state + accumulate segment energy from one snapshot. */
  track(watts: number, now: number): void {
    const dtMs = this.lastTickAt > 0 ? now - this.lastTickAt : this.sampleIntervalSeconds() * 1000
    this.lastTickAt = now
    this.stateDurMs += dtMs
    this.stateKWh += (watts * dtMs) / 3600000
    this.stateWSum += watts * dtMs

    // Idle detection, throttled to every 5s (getSystemIdleTime is cheap but
    // still a syscall we don't need every sample). Direct assignment, not
    // Math.max: the OS value already decays with activity, so the state must
    // be able to leave idle/screen-off when the user comes back.
    if (now - this.lastIdleCheckAt > 5000) {
      this.lastIdleCheckAt = now
      try {
        this.idleSeconds = powerMonitor.getSystemIdleTime()
      } catch {
        // keep previous
      }
    }
    const desired: MachineState =
      this.state === 'sleep'
        ? 'sleep'
        : this.idleSeconds * 1000 >= SCREEN_OFF_MS
          ? 'screen-off'
          : this.idleSeconds * 1000 >= IDLE_MS
            ? 'idle'
            : 'active'
    if (desired !== this.state) {
      this.finalize(now)
      this.begin(desired)
    }
  }

  finalize(toMs: number): void {
    if (this.stateDurMs <= 0) return
    const durSec = this.stateDurMs / 1000
    try {
      insertMachineState(this.stateFrom, toMs, this.state, this.stateWSum / durSec, this.stateKWh)
    } catch {
      // best-effort
    }
  }

  private onSuspend(): void {
    this.finalize(Date.now())
    this.begin('sleep')
  }

  private onResume(): void {
    this.finalize(Date.now())
    this.idleSeconds = 0
    this.begin('active')
  }

  private begin(state: MachineState): void {
    this.state = state
    this.stateFrom = Date.now()
    this.stateDurMs = 0
    this.stateWSum = 0
    this.stateKWh = 0
  }
}
