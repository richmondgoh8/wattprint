import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Electron is not available in the node test env; mock the powerMonitor surface
// the ledger touches.
vi.mock('electron', () => {
  return {
    powerMonitor: {
      getSystemIdleTime: vi.fn(() => 0),
      on: vi.fn()
    }
  }
})

import { initStore, closeStore, machineStateRange, resetStatistics } from '../src/main/store.js'
import { StateLedger } from '../src/main/ledger.js'
import { powerMonitor } from 'electron'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'wattprint-ledger-test-'))
  initStore(dir)
})

afterAll(() => {
  closeStore()
  rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  resetStatistics()
  vi.mocked(powerMonitor.getSystemIdleTime).mockReset()
  vi.mocked(powerMonitor.getSystemIdleTime).mockReturnValue(0)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('StateLedger', () => {
  it('returns to active after a screen-off episode once the user is active again', () => {
    const ledger = new StateLedger(() => 1)
    const t0 = Date.now()

    // 5 minutes idle -> screen-off
    vi.mocked(powerMonitor.getSystemIdleTime).mockReturnValue(301)
    for (let i = 1; i <= 61; i++) {
      ledger.track(50, t0 + i * 5000)
    }

    // User returns: idle time drops to 0 -> back to active. Before the fix
    // the ledger kept the stale high idle value and stayed screen-off.
    vi.mocked(powerMonitor.getSystemIdleTime).mockReturnValue(0)
    for (let i = 62; i <= 80; i++) {
      ledger.track(50, t0 + i * 5000)
    }
    ledger.finalize(t0 + 80 * 5000)

    const rows = machineStateRange(new Date(t0), new Date(t0 + 80 * 5000))
    const states = rows.map((r) => r.state)
    expect(states).toContain('screen-off')
    expect(states[states.length - 1]).toBe('active')
  })

  it('stays active while the user is active', () => {
    const ledger = new StateLedger(() => 1)
    const t0 = Date.now()
    ledger.init()

    for (let i = 1; i <= 30; i++) {
      ledger.track(100, t0 + i * 5000)
    }
    ledger.finalize(t0 + 30 * 5000)

    const rows = machineStateRange(new Date(t0), new Date(t0 + 30 * 5000))
    expect(rows.map((r) => r.state)).toEqual(['active'])
  })
})
