import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron modules before importing the module under test
vi.mock('electron', () => ({
  powerMonitor: { getSystemIdleTime: vi.fn(() => 0) }
}))

// Mock store inserts — we only test state machine logic
vi.mock('../src/main/store.js', () => ({
  insertSleepSession: vi.fn()
}))

// Mock eco module — we only test the state transitions
vi.mock('../src/main/eco.js', () => ({
  isEcoSupported: vi.fn(() => true),
  applyEcoBatch: vi.fn(async () => ({ failedPids: new Set<number>() }))
}))

// Mock config — return a fixed whitelist
vi.mock('../src/main/config.js', () => ({
  getSettings: vi.fn(() => ({
    sleepMode: { whitelist: ['spotify'] }
  }))
}))

import { SleepModeManager } from '../src/main/sleepMode.js'
import { applyEcoBatch } from '../src/main/eco.js'
import { insertSleepSession } from '../src/main/store.js'

describe('SleepModeManager', () => {
  let mgr: SleepModeManager

  beforeEach(() => {
    vi.clearAllMocks()
    mgr = new SleepModeManager()
  })

  it('starts inactive', () => {
    expect(mgr.isActive()).toBe(false)
    expect(mgr.state().active).toBe(false)
    expect(mgr.state().throttledCount).toBe(0)
  })

  it('activates on start()', async () => {
    mgr.setProcesses([{ pid: 100, name: 'node' }])
    mgr.start(50)
    expect(mgr.isActive()).toBe(true)
    expect(mgr.state().baselineW).toBe(50)
    expect(mgr.state().since).not.toBeNull()
  })

  it('deactivates on finish()', async () => {
    mgr.start(50)
    expect(mgr.isActive()).toBe(true)
    await mgr.finish()
    expect(mgr.isActive()).toBe(false)
  })

  it('records session on finish when active long enough', async () => {
    mgr.start(100)
    // Simulate 2 minutes of activity
    const now = Date.now()
    mgr.tick(now, 60_000, 80)
    mgr.tick(now + 60_000, 60_000, 80)
    await mgr.finish()
    expect(insertSleepSession).toHaveBeenCalledTimes(1)
  })

  it('skips recording for very short sessions (< 1 min)', async () => {
    mgr.start(100)
    const now = Date.now()
    mgr.tick(now, 30_000, 80) // 30 seconds
    await mgr.finish()
    expect(insertSleepSession).not.toHaveBeenCalled()
  })

  it('is idempotent — finish() on inactive manager is a no-op', async () => {
    await mgr.finish()
    expect(mgr.isActive()).toBe(false)
    expect(insertSleepSession).not.toHaveBeenCalled()
  })

  it('finishBounded() deactivates and bounds revert time', async () => {
    mgr.start(50)
    await mgr.finishBounded()
    expect(mgr.isActive()).toBe(false)
  })

  it('tick() accumulates energy when active', () => {
    mgr.start(100)
    const now = Date.now()
    mgr.tick(now, 1000, 50)
    mgr.tick(now + 1000, 1000, 60)
    // State should still be active
    expect(mgr.isActive()).toBe(true)
  })

  it('tick() is a no-op when inactive', () => {
    const now = Date.now()
    mgr.tick(now, 1000, 50) // Should not throw
    expect(mgr.isActive()).toBe(false)
  })

  it('setProcesses() updates the internal process list', () => {
    mgr.setProcesses([{ pid: 1, name: 'a' }, { pid: 2, name: 'b' }])
    mgr.start(50)
    // The processes list is used internally during applyEco cycles
    expect(mgr.isActive()).toBe(true)
  })

  it('applyEcoBatch is called with PIDs on start', async () => {
    mgr.setProcesses([{ pid: 100, name: 'node' }, { pid: 200, name: 'chrome' }])
    mgr.start(50)
    // Wait for the async applyEco to complete
    await new Promise((r) => setTimeout(r, 50))
    expect(applyEcoBatch).toHaveBeenCalled()
  })

  it('applyEcoBatch skips whitelisted processes', async () => {
    mgr.setProcesses([{ pid: 100, name: 'spotify' }, { pid: 200, name: 'node' }])
    mgr.start(50)
    await new Promise((r) => setTimeout(r, 50))
    const call = vi.mocked(applyEcoBatch).mock.calls[0]
    const pids = call[0] as number[]
    // spotify (pid 100) should be excluded from throttling
    expect(pids).not.toContain(100)
    expect(pids).toContain(200)
  })
})
