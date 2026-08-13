import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  initStore,
  closeStore,
  writeSamples,
  rollupHour,
  hourlyRange,
  totalsByKey,
  sampleTotalsByKey,
  totalsMerged,
  getReadiness,
  trackingStart,
  trackingCoverage,
  allTimeComponentStats,
  scrubBadData,
  rollupMissingHours,
  insertMachineState,
  lastMachineStateEnd,
  machineStateRange,
  machineStateTotals,
  pruneSamples,
  pruneMachineStates
} from '../src/main/store.js'

const HOUR_MS = 3600 * 1000
let dir: string

/** Raw SQL against the shared test DB (for simulating legacy data). */
function poke(sql: string): void {
  const d = new Database(join(dir, 'wattprint.db'))
  d.exec(sql)
  d.close()
}

function rollupMinutesAt(hourSec: number): number {
  const d = new Database(join(dir, 'wattprint.db'), { readonly: true })
  const r = d.prepare('SELECT MAX(minutes) AS m FROM hourly_rollups WHERE hour = ?').get(hourSec) as { m: number | null }
  d.close()
  return r.m ?? 0
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'wattprint-test-'))
  initStore(dir)
})

afterAll(() => {
  closeStore()
  rmSync(dir, { recursive: true, force: true })
})

// Every test writes into its own hour bucket: rollups re-aggregate all raw
// samples in an hour, so sharing an hour across tests would accumulate.
let bucket = 0
function nextHour(): number {
  const base = Math.floor(Date.now() / 3600000) * 3600000
  return base + bucket++ * HOUR_MS
}

describe('writeSamples + rollupHour', () => {
  it('weights kWh, average, and coverage by the interval', () => {
    const hour = nextHour()
    const from = new Date(hour)
    writeSamples(
      [
        { ts: from, scope: 'component', key: 'cpu', watts: 100, intervalSeconds: 60 },
        { ts: new Date(hour + 60_000), scope: 'component', key: 'cpu', watts: 200, intervalSeconds: 60 },
        { ts: new Date(hour + 120_000), scope: 'component', key: 'cpu', watts: 300, intervalSeconds: 60 }
      ],
      1
    )
    rollupHour(new Date(hour))

    const rows = hourlyRange(new Date(hour), new Date(hour + HOUR_MS), 'component').filter((r) => r.key === 'cpu')
    expect(rows).toHaveLength(1)
    expect(rows[0].kWh).toBeCloseTo((100 + 200 + 300) * 60 / 3600000, 9)
    expect(rows[0].avgW).toBeCloseTo(200, 9)
    expect(rows[0].maxW).toBeCloseTo(300, 9)
    expect(rows[0].minutes).toBeCloseTo(3, 9)
  })

  it('rollup replaces rows for the same hour (idempotent re-roll)', () => {
    const hour = nextHour()
    writeSamples([{ ts: new Date(hour), scope: 'component', key: 'disk', watts: 50 }], 1)
    rollupHour(new Date(hour))
    rollupHour(new Date(hour))
    const rows = hourlyRange(new Date(hour), new Date(hour + HOUR_MS), 'component').filter((r) => r.key === 'disk')
    expect(rows).toHaveLength(1)
    expect(rows[0].kWh).toBeCloseTo(50 / 3600000, 9)
  })

  it('clamps minutes to one hour even when intervals exceed it', () => {
    const hour = nextHour()
    // Two samples covering 2 h of interval inside a single hour (e.g. an
    // uncapped sleep-gap batch) must not inflate the rollup's minutes.
    writeSamples(
      [
        { ts: new Date(hour), scope: 'component', key: 'cpu', watts: 100, intervalSeconds: 3600 },
        { ts: new Date(hour + 30 * 1000), scope: 'component', key: 'cpu', watts: 100, intervalSeconds: 3600 }
      ],
      1
    )
    rollupHour(new Date(hour))
    const rows = hourlyRange(new Date(hour), new Date(hour + HOUR_MS), 'component').filter((r) => r.key === 'cpu')
    expect(rows[0].minutes).toBe(60)
  })
})

describe('totalsByKey', () => {
  it('aggregates kWh across the range and excludes idle/gpu-other process rows', () => {
    const hour = nextHour()
    writeSamples([
      { ts: new Date(hour), scope: 'component', key: 'cpu', watts: 100 },
      { ts: new Date(hour), scope: 'process', key: 'chrome', watts: 60 },
      { ts: new Date(hour), scope: 'process', key: 'system idle process', watts: 40 },
      { ts: new Date(hour), scope: 'process', key: '[gpu other]', watts: 10 }
    ], 1)
    rollupHour(new Date(hour))

    const procs = totalsByKey(new Date(hour), new Date(hour + HOUR_MS), 'process')
    const keys = procs.map((r) => r.key)
    expect(keys).toContain('chrome')
    expect(keys).not.toContain('system idle process')
    expect(keys).not.toContain('[gpu other]')

    const comps = totalsByKey(new Date(hour), new Date(hour + HOUR_MS), 'component')
    expect(comps.find((r) => r.key === 'cpu')?.kWh).toBeCloseTo(100 / 3600000, 9)
  })
})

describe('sampleTotalsByKey', () => {
  it('aggregates raw samples with interval weighting', () => {
    const hour = nextHour()
    writeSamples([
      { ts: new Date(hour), scope: 'process', key: 'chrome', watts: 100, intervalSeconds: 5 },
      { ts: new Date(hour + 5000), scope: 'process', key: 'chrome', watts: 200, intervalSeconds: 5 }
    ], 1)
    const rows = sampleTotalsByKey(new Date(hour), new Date(hour + HOUR_MS), 'process')
    const chrome = rows.find((r) => r.key === 'chrome')
    expect(chrome?.kWh).toBeCloseTo((100 + 200) * 5 / 3600000, 9)
    expect(chrome?.avgW).toBeCloseTo(150, 9)
  })
})

describe('totalsMerged', () => {
  it('combines completed rollups with the in-progress raw hour without double counting', () => {
    // The real previous hour: completed, so it can carry a rollup.
    const hour = Math.floor(Date.now() / 3600000) * 3600000 - 3600000
    writeSamples([{ ts: new Date(hour), scope: 'process', key: 'chrome', watts: 100, intervalSeconds: 3600 }], 1)
    rollupHour(new Date(hour))
    // Raw rows for the completed hour still exist — they must NOT be added
    // again (the partial-hour window starts at the current hour boundary).
    writeSamples([{ ts: new Date(Date.now() - 5000), scope: 'process', key: 'chrome', watts: 200, intervalSeconds: 30 }], 1)

    const rows = totalsMerged(new Date(hour - 3600 * 1000), new Date(Date.now() + 60 * 1000), 'process')
    const chrome = rows.find((r) => r.key === 'chrome')
    expect(chrome).toBeDefined()
    // Rollup: 100 W × 1 h = 0.1 kWh. Partial: 200 W × 30 s = 0.00167 kWh.
    expect(chrome?.kWh).toBeCloseTo((100 * 3600 + 200 * 30) / 3600000, 9)
  })

  it('returns raw-only when the window lies entirely inside the current hour', () => {
    const now = Date.now()
    const hourStart = Math.floor(now / 3600000) * 3600000
    writeSamples([{ ts: new Date(hourStart + 30 * 1000), scope: 'process', key: 'game', watts: 300, intervalSeconds: 30 }], 1)

    const rows = totalsMerged(new Date(hourStart), new Date(now + 60 * 1000), 'process')
    const game = rows.find((r) => r.key === 'game')
    expect(game?.kWh).toBeCloseTo((300 * 30) / 3600000, 9)
  })
})

describe('getReadiness', () => {
  it('reports latest sample and rollup presence', () => {
    const r = getReadiness(7)
    expect(r.latestSampleAt).toBeTypeOf('number')
    expect(r.processSamplesAvailable).toBe(true)
    expect(r.hourlyBucketsAvailable).toBeGreaterThanOrEqual(1)
  })
})

describe('trackingStart + allTimeComponentStats', () => {
  it('reports the first tracked moment', () => {
    const start = trackingStart()
    expect(start).toBeTypeOf('string')
    expect(new Date(start as string).getTime()).toBeGreaterThan(0)
  })

  it('sums actual tracked minutes, not the wall-clock span', () => {
    const hour = nextHour()
    writeSamples([{ ts: new Date(hour), scope: 'component', key: 'cpu', watts: 100, intervalSeconds: 3600 }], 1)
    rollupHour(new Date(hour))
    writeSamples([{ ts: new Date(), scope: 'component', key: 'disk', watts: 200 }], 1)

    const cov = trackingCoverage()
    expect(cov.firstTrackedAt).toBeTypeOf('string')
    expect(cov.coveredHours).toBeGreaterThanOrEqual(1)
    expect(cov.coveredHours).toBeLessThan(48)
  })

  it('bounds coverage to a since timestamp', () => {
    const hour = nextHour()
    writeSamples([{ ts: new Date(hour), scope: 'component', key: 'cpu', watts: 100, intervalSeconds: 60 }], 1)
    rollupHour(new Date(hour))

    const since = Math.floor(hour / 1000) + 3600
    const cov = trackingCoverage(since)
    expect(cov.firstTrackedAt).toBeTypeOf('string')
    expect(cov.coveredHours).toBe(0)
  })

  it('counts active hours from closed ledger segments, clamped to the window', () => {
    poke('DELETE FROM machine_states')
    const t0 = Math.floor(Date.now() / 1000) - 7200
    insertMachineState((t0 - 3600) * 1000, t0 * 1000, 'idle', 5, 0.001)
    insertMachineState(t0 * 1000, (t0 + 3600) * 1000, 'active', 50, 0.05)
    insertMachineState((t0 + 3600) * 1000, (t0 + 5400) * 1000, 'active', 50, 0.025)

    const cov = trackingCoverage(t0)
    // 1 h + 0.5 h of active segments inside the window; the idle segment and
    // anything before the window don't count.
    expect(cov.activeHours).toBeCloseTo(1.5, 6)
  })

  it('adds the live active tail only when the current state is active', () => {
    poke('DELETE FROM machine_states')
    const t0 = Math.floor(Date.now() / 1000) - 3600
    insertMachineState((t0 - 3600) * 1000, t0 * 1000, 'active', 50, 0.05)

    const idleCov = trackingCoverage(t0, 'screen-off')
    expect(idleCov.activeHours).toBeCloseTo(0, 6)

    const activeCov = trackingCoverage(t0, 'active')
    // 1 closed hour + the live tail (which spans up to ~1h since t0).
    expect(activeCov.activeHours).toBeGreaterThanOrEqual(1)
    expect(activeCov.activeHours).toBeLessThanOrEqual(2)
  })

  it('adds no live tail when the ledger has never flushed a segment', () => {
    poke('DELETE FROM machine_states')
    const cov = trackingCoverage(undefined, 'active')
    expect(cov.activeHours).toBe(0)
  })

  it('counts a multi-key hour once (wall-clock, not per-key sum)', () => {
    const hour = nextHour()
    // All five component keys sampled the full hour — the hour was tracked
    // once, not five times.
    for (const key of ['cpu', 'gpu', 'ram', 'disk', 'net']) {
      writeSamples([{ ts: new Date(hour), scope: 'component', key, watts: 10, intervalSeconds: 3600 }], 1)
    }
    rollupHour(new Date(hour))
    // Bound to this one (future) hour: five keys → exactly one hour of wall time.
    expect(trackingCoverage(Math.floor(hour / 1000)).coveredHours).toBeCloseTo(1, 9)
  })

  it('weights the all-time average by wall-clock minutes, not per-key minutes', () => {
    const before = allTimeComponentStats()
    const hour = nextHour()
    writeSamples([
      { ts: new Date(hour), scope: 'component', key: 'cpu', watts: 100, intervalSeconds: 3600 },
      { ts: new Date(hour), scope: 'component', key: 'ram', watts: 50, intervalSeconds: 3600 }
    ], 1)
    rollupHour(new Date(hour))

    const after = allTimeComponentStats()
    const addedKwh = ((100 + 50) * 3600) / 3600000
    const addedMin = 60 // one wall-clock hour, not 120 (per-key)
    const expectedAvgW = ((before.totalKWh + addedKwh) * 60000) / (before.coveredHours * 60 + addedMin)
    expect(after.totalKWh).toBeCloseTo(before.totalKWh + addedKwh, 9)
    expect(after.avgW).toBeCloseTo(expectedAvgW, 6)
  })

  it('aggregates completed rollups plus the in-progress raw hour', () => {
    const hour = nextHour()
    writeSamples(
      [
        { ts: new Date(hour), scope: 'component', key: 'cpu', watts: 100, intervalSeconds: 3600 },
        { ts: new Date(hour), scope: 'component', key: 'ram', watts: 50, intervalSeconds: 3600 }
      ],
      1
    )
    rollupHour(new Date(hour))
    writeSamples([{ ts: new Date(), scope: 'component', key: 'disk', watts: 200 }], 1)

    const stats = allTimeComponentStats()
    expect(stats.firstTrackedAt).toBeTypeOf('string')
    expect(stats.coveredHours).toBeGreaterThanOrEqual(1)
    expect(stats.totalKWh).toBeGreaterThanOrEqual((150 * 3600) / 3600000)
    expect(stats.avgW).toBeGreaterThan(0)
  })
})

describe('rollupMissingHours', () => {
  it('rolls up stale hours with samples and skips clean ones', () => {
    // A completed hour from a "previous session" whose samples were never
    // rolled up (e.g. the trailing partial hour of a session).
    const staleHour = nextHour()
    writeSamples([{ ts: new Date(staleHour), scope: 'component', key: 'cpu', watts: 100, intervalSeconds: 3600 }], 1)

    const rolled = rollupMissingHours(new Date(staleHour + 2 * HOUR_MS))
    expect(rolled).toBeGreaterThanOrEqual(1)

    const rows = hourlyRange(new Date(staleHour), new Date(staleHour + HOUR_MS), 'component')
    expect(rows.find((r) => r.key === 'cpu')?.kWh).toBeCloseTo(100 * 3600 / 3600000, 9)

    // A second pass finds nothing left to roll.
    expect(rollupMissingHours(new Date(staleHour + 2 * HOUR_MS))).toBe(0)
  })
})

describe('scrubBadData', () => {
  it('removes legacy units-bug rows and keeps good ones', () => {
    const hour = nextHour()
    writeSamples([
      { ts: new Date(hour), scope: 'component', key: 'cpu', watts: 100 },
      { ts: new Date(hour), scope: 'component', key: 'disk', watts: 6_800_000 }
    ], 1)
    rollupHour(new Date(hour))

    const badHour = nextHour()
    writeSamples([{ ts: new Date(badHour), scope: 'component', key: 'gpu', watts: 6_800_000 }], 1)
    rollupHour(new Date(badHour))

    scrubBadData()

    const rows = totalsByKey(new Date(hour), new Date(hour + HOUR_MS), 'component')
    expect(rows.map((r) => r.key)).toContain('cpu')
    expect(rows.map((r) => r.key)).not.toContain('disk')

    const badRollups = totalsByKey(new Date(badHour), new Date(badHour + HOUR_MS), 'component')
    expect(badRollups.length).toBe(0)
  })

  it('removes first-batch interval pollution (unix timestamps as interval_s)', () => {
    const hour = nextHour()
    // The first process write after launch used interval_s = Date.now()/1000.
    writeSamples([
      { ts: new Date(hour), scope: 'process', key: 'chrome', watts: 50, intervalSeconds: 1_786_000_000 },
      { ts: new Date(hour), scope: 'process', key: 'chrome', watts: 50, intervalSeconds: 5 }
    ], 5)
    rollupHour(new Date(hour))

    scrubBadData()

    // The polluted sample is gone; only the legitimate 5s row remains.
    const remaining = sampleTotalsByKey(new Date(hour), new Date(hour + HOUR_MS), 'process')
    const chrome = remaining.find((r) => r.key === 'chrome')
    expect(chrome?.kWh ?? 0).toBeLessThan(0.001)
    // The rollup derived from the polluted row is gone too.
    const rolls = totalsByKey(new Date(hour), new Date(hour + HOUR_MS), 'process')
    expect(rolls.map((r) => r.key)).not.toContain('chrome')
  })

  it('clamps legacy inflated rollup minutes to one hour', () => {
    // Legacy builds computed minutes = COUNT/60, writing e.g. 1001 minutes
    // for a single process hour. The scrub must clamp, not delete — kWh and
    // avgW stay valid.
    const hour = nextHour()
    writeSamples([{ ts: new Date(hour), scope: 'process', key: 'svchost', watts: 50, intervalSeconds: 3600 }], 1)
    rollupHour(new Date(hour))
    poke(`UPDATE hourly_rollups SET minutes = 1001 WHERE hour = ${Math.floor(hour / 1000)}`)

    scrubBadData()

    const rows = totalsByKey(new Date(hour), new Date(hour + HOUR_MS), 'process')
    const svchost = rows.find((r) => r.key === 'svchost')
    expect(svchost?.kWh).toBeGreaterThan(0)
    expect(rollupMinutesAt(Math.floor(hour / 1000))).toBe(60)
  })
})

describe('machine states', () => {
  it('round-trips segments, totals, and the last-end marker', () => {
    poke('DELETE FROM machine_states')
    const now = Date.now()
    insertMachineState(now - 3600_000, now - 1800_000, 'idle', 40, 0.02)
    insertMachineState(now - 1800_000, now, 'active', 100, 0.05)

    expect(lastMachineStateEnd()).toBe(Math.floor(now / 1000))

    const from = new Date(now - 2 * 3600_000)
    const rows = machineStateRange(from, new Date())
    expect(rows.map((r) => r.state).sort()).toEqual(['active', 'idle'])

    const totals = machineStateTotals(from, new Date())
    const idle = totals.find((t) => t.state === 'idle')
    expect(idle?.kWh).toBeCloseTo(0.02, 9)
    expect(idle?.avgW).toBeCloseTo(40, 6)
  })
})

describe('pruning', () => {
  it('deletes only stale rows', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const stale = nowSec - 200 * 24 * 3600
    const fresh = nowSec - 3600
    writeSamples([
      { ts: new Date(stale * 1000), scope: 'component', key: 'prune-me-stale', watts: 1 },
      { ts: new Date(fresh * 1000), scope: 'component', key: 'prune-me-fresh', watts: 1 }
    ], 1)
    await pruneSamples(nowSec - 48 * 3600)
    const remaining = sampleTotalsByKey(new Date(stale * 1000), new Date(), 'component')
    const keys = remaining.map((r) => r.key)
    expect(keys).toContain('prune-me-fresh')
    expect(keys).not.toContain('prune-me-stale')

    insertMachineState((nowSec - 200 * 24 * 3600) * 1000, (nowSec - 199 * 24 * 3600) * 1000, 'off', 0, 0)
    await pruneMachineStates(nowSec - 30 * 24 * 3600)
    expect(machineStateRange(new Date(0), new Date()).every((r) => r.state !== 'off')).toBe(true)
  })
})
