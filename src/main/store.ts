// SQLite repository. better-sqlite3 (sync API, very fast).
// Same schema as internal/store/store.go in the Wails version.
// One file: <userData>/wattprint.db, WAL mode.

import BetterSqlite3, { type Database } from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import type { KeyTotal, HourlyRollup, MachineState, MachineStateRow, SleepSession } from '../shared/types.js'

interface SampleRow {
  ts: number
  scope: string
  key: string
  watts: number
}

let db: Database | null = null

export function initStore(userDataDir: string): void {
  if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true })
  const path = join(userDataDir, 'wattprint.db')
  db = new BetterSqlite3(path)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  db.exec(`
    CREATE TABLE IF NOT EXISTS samples (
      ts    INTEGER NOT NULL,
      scope TEXT    NOT NULL,
      key   TEXT    NOT NULL,
      watts REAL    NOT NULL,
      interval_s REAL NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_samples_ts  ON samples(ts);
    CREATE INDEX IF NOT EXISTS idx_samples_key ON samples(scope, key, ts);
    -- Partial index over rows the startup scrub cares about: only abnormal
    -- rows are indexed, so clean data pays no index-maintenance cost.
    CREATE INDEX IF NOT EXISTS idx_samples_bad ON samples(interval_s)
      WHERE watts > 50000 OR interval_s > 86400;

    CREATE TABLE IF NOT EXISTS hourly_rollups (
      hour    INTEGER NOT NULL,
      scope   TEXT    NOT NULL,
      key     TEXT    NOT NULL,
      kwh     REAL    NOT NULL,
      gpu_kwh REAL    NOT NULL DEFAULT 0,
      avg_w   REAL    NOT NULL,
      max_w   REAL    NOT NULL,
      minutes REAL    NOT NULL,
      PRIMARY KEY (hour, scope, key)
    );
    CREATE INDEX IF NOT EXISTS idx_rollups_key ON hourly_rollups(scope, key, hour);

    CREATE TABLE IF NOT EXISTS machine_states (
      from_ts INTEGER NOT NULL,
      to_ts   INTEGER NOT NULL,
      state   TEXT    NOT NULL,
      avg_w   REAL    NOT NULL,
      kwh     REAL    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_machine_states_ts ON machine_states(from_ts);

    CREATE TABLE IF NOT EXISTS schema_version (
      id      INTEGER PRIMARY KEY,
      version INTEGER NOT NULL
    );
  `)

  // Schema migrations. Each migration is idempotent: it only runs if the
  // recorded version is less than the target. We use a single version row
  // keyed by id=0, so we can use INSERT OR REPLACE for a clean upsert.
  const SCHEMA_ID = 0
  const schemaColumns = db.prepare('PRAGMA table_info(schema_version)').all() as { name: string }[]
  if (!schemaColumns.some((column) => column.name === 'id')) {
    const legacy = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
      | { version: number }
      | undefined
    db.exec(`
      DROP TABLE schema_version;
      CREATE TABLE schema_version (
        id INTEGER PRIMARY KEY,
        version INTEGER NOT NULL
      );
    `)
    db.prepare('INSERT INTO schema_version(id, version) VALUES (?, ?)').run(SCHEMA_ID, legacy?.version ?? 0)
  }
  const canonical = db.prepare('SELECT version FROM schema_version WHERE id = ?').get(SCHEMA_ID) as
    | { version: number }
    | undefined
  if (!canonical) {
    // Older builds accidentally inserted the schema id into `version`, creating
    // row id 1 with version 0. Repair that marker without deleting this session's data.
    const legacy = db.prepare('SELECT version FROM schema_version WHERE id != ? LIMIT 1').get(SCHEMA_ID) as
      | { version: number }
      | undefined
    if (legacy?.version === 0) {
      db.prepare('INSERT OR REPLACE INTO schema_version(id, version) VALUES (?, ?)').run(SCHEMA_ID, 2)
      db.prepare('DELETE FROM schema_version WHERE id != ?').run(SCHEMA_ID)
    } else {
      db.prepare('INSERT OR IGNORE INTO schema_version(id, version) VALUES (?, ?)').run(SCHEMA_ID, 0)
    }
  }
  const current =
    (db.prepare('SELECT version FROM schema_version WHERE id = ?').get(SCHEMA_ID) as
      | { version: number }
      | undefined)?.version ?? 0

  let migratedVersion = current
  if (migratedVersion < 2) {
    // v2: nuke historical samples + rollups. Reason: the v0.1 disk estimator
    // had a units bug that wrote values like 6.8 MW to the DB. We've fixed
    // it, but the bad rows are still in storage. Wipe once; future writes
    // are correct.
    db.exec('DELETE FROM samples; DELETE FROM hourly_rollups;')
    db.prepare('UPDATE schema_version SET version = ? WHERE id = ?').run(2, SCHEMA_ID)
    migratedVersion = 2
  }

  if (migratedVersion < 3) {
    const sampleColumns = db.prepare('PRAGMA table_info(samples)').all() as { name: string }[]
    if (!sampleColumns.some((column) => column.name === 'interval_s')) {
      db.exec('ALTER TABLE samples ADD COLUMN interval_s REAL NOT NULL DEFAULT 1')
    }
    db.prepare('UPDATE schema_version SET version = ? WHERE id = ?').run(3, SCHEMA_ID)
  }

  if (migratedVersion < 4) {
    const sampleColumns = db.prepare('PRAGMA table_info(samples)').all() as { name: string }[]
    if (!sampleColumns.some((column) => column.name === 'gpu_w')) {
      db.exec('ALTER TABLE samples ADD COLUMN gpu_w REAL NOT NULL DEFAULT 0')
    }
    const rollupColumns = db.prepare('PRAGMA table_info(hourly_rollups)').all() as { name: string }[]
    if (!rollupColumns.some((column) => column.name === 'gpu_kwh')) {
      db.exec('ALTER TABLE hourly_rollups ADD COLUMN gpu_kwh REAL NOT NULL DEFAULT 0')
    }
    db.prepare('UPDATE schema_version SET version = ? WHERE id = ?').run(4, SCHEMA_ID)
  }

  if (migratedVersion < 5) {
    // Remove legacy synthetic GPU bucket rows (no longer produced).
    db.exec("DELETE FROM samples WHERE scope = 'process' AND lower(key) = '[gpu other]'")
    db.exec("DELETE FROM hourly_rollups WHERE scope = 'process' AND lower(key) = '[gpu other]'")
    db.exec(`CREATE TABLE IF NOT EXISTS sleep_sessions (
      start_ts INTEGER NOT NULL,
      end_ts   INTEGER NOT NULL,
      avg_w    REAL NOT NULL,
      baseline_w REAL NOT NULL,
      kwh      REAL NOT NULL,
      saved_kwh REAL NOT NULL,
      throttled_count INTEGER NOT NULL,
      PRIMARY KEY (start_ts)
    )`)
    db.prepare('UPDATE schema_version SET version = ? WHERE id = ?').run(5, SCHEMA_ID)
  }

  if (migratedVersion < 6) {
    // Recorded for history; the actual scrub below runs on every open so
    // any buggy rows are dropped even if they appear after the migration.
    db.prepare('UPDATE schema_version SET version = ? WHERE id = ?').run(6, SCHEMA_ID)
  }

  // Self-healing: drop impossible rows on every open — the v0.1 disk-estimator
  // units bug (values like 6.8 MW) and the first-batch interval bug (unix
  // timestamps written as interval_s, inflating kWh ~500x per app start).
  scrubBadData()
}

/** Delete rows above physical limits (legacy units-bug values and the
 *  first-batch interval bug that wrote unix timestamps as intervals).
 *  Exported for tests; safe to re-run anytime. Skips quickly when the data
 *  is clean (LIMIT-1 existence probe instead of unconditional full scans). */
export function scrubBadData(): void {
  const d = requireDb()
  const dirty = d
    .prepare(
      `SELECT 1 AS dirty
       FROM samples WHERE watts > 50000 OR interval_s > 86400
       UNION ALL
       SELECT 1 FROM hourly_rollups WHERE avg_w > 50000 OR kwh > 10 OR minutes > 60
       UNION ALL
       SELECT 1 FROM machine_states WHERE avg_w > 50000
       LIMIT 1`
    )
    .get() as { dirty: number } | undefined
  if (!dirty) return
  d.exec(`
    DELETE FROM samples WHERE watts > 50000 OR interval_s > 86400;
    DELETE FROM hourly_rollups WHERE avg_w > 50000 OR kwh > 10;
    DELETE FROM machine_states WHERE avg_w > 50000;
    -- Legacy rollups carried inflated minutes (old COUNT/60 math for process
    -- rows, and uncapped sleep-gap intervals). A rollup row can never cover
    -- more than one hour of wall time, so clamp instead of deleting: kWh,
    -- avgW and maxW stay valid, and coverage/weighting become sane again.
    UPDATE hourly_rollups SET minutes = 60 WHERE minutes > 60;
  `)
}

/** Roll up every hour that has raw samples but no rollup yet (bounded by the
 *  48 h sample retention). Called at startup so a session's trailing partial
 *  hour is never lost to the sample prune. Returns the number of hours rolled. */
export function rollupMissingHours(now = new Date()): number {
  const d = requireDb()
  const last = (d.prepare('SELECT MAX(hour) AS last FROM hourly_rollups').get() as { last: number | null }).last ?? 0
  // Only completed hours can be rolled; the in-progress hour waits for the
  // next boundary. Hours at or below the last rollup are already covered.
  const lastCompleteSec = Math.floor(now.getTime() / 3600000) * 3600 - 3600
  if (lastCompleteSec <= last) return 0
  const rows = d
    .prepare('SELECT DISTINCT CAST(ts / 3600 AS INTEGER) AS h FROM samples WHERE ts >= ? AND ts < ? ORDER BY h ASC')
    .all(last + 3600, lastCompleteSec) as { h: number }[]
  for (const r of rows) {
    rollupHour(new Date(r.h * 3600 * 1000))
  }
  return rows.length
}

export function closeStore(): void {
  if (db) {
    db.close()
    db = null
  }
}

export function resetStatistics(): void {
  const d = requireDb()
  const clear = d.transaction(() => {
    d.exec('DELETE FROM samples; DELETE FROM hourly_rollups; DELETE FROM machine_states;')
  })
  clear()
}

function requireDb(): Database {
  if (!db) throw new Error('store not initialized')
  return db
}

// ---- Writes ----

/** Insert a batch of samples. Rows may carry their own interval (e.g. throttled
 *  process samples); otherwise the batch `intervalSeconds` fallback is used. */
export function writeSamples(
  samples: { ts: Date; scope: string; key: string; watts: number; gpuW?: number; intervalSeconds?: number }[],
  intervalSeconds = 1
): void {
  if (samples.length === 0) return
  const d = requireDb()
  const stmt = d.prepare('INSERT INTO samples (ts, scope, key, watts, interval_s, gpu_w) VALUES (?, ?, ?, ?, ?, ?)')
  const tx = d.transaction((rows: typeof samples) => {
    for (const s of rows) {
      stmt.run(Math.floor(s.ts.getTime() / 1000), s.scope, s.key, s.watts, s.intervalSeconds ?? intervalSeconds, s.gpuW ?? 0)
    }
  })
  tx(samples)
}

/** Compute the hourly rollup for the given hour and replace existing rows. */
export function rollupHour(hour: Date): void {
  const d = requireDb()
  const from = Math.floor(hour.getTime() / 1000)
  const to = from + 3600
  d.prepare('DELETE FROM hourly_rollups WHERE hour = ?').run(from)

  // Weight energy, averages, and coverage by each sample's actual interval.
  // minutes is clamped to one hour: a rollup row can never cover more wall
  // time than the hour itself, and legacy builds wrote inflated values
  // (COUNT/60 for process rows) that would otherwise distort coverage.
  const rows = d
    .prepare(
      `SELECT scope, key,
              SUM(watts * interval_s) / 3600000.0 AS kwh,
              SUM(gpu_w * interval_s) / 3600000.0 AS gpu_kwh,
              SUM(watts * interval_s) / NULLIF(SUM(interval_s), 0) AS avg_w,
              MAX(watts)              AS max_w,
              MIN(SUM(interval_s) / 60.0, 60) AS minutes
       FROM samples
       WHERE ts >= ? AND ts < ?
       GROUP BY scope, key`
    )
    .all(from, to) as { scope: string; key: string; kwh: number; gpu_kwh: number; avg_w: number; max_w: number; minutes: number }[]

  if (rows.length === 0) return

  const ins = d.prepare(
    'INSERT INTO hourly_rollups (hour, scope, key, kwh, gpu_kwh, avg_w, max_w, minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const tx = d.transaction((rs: typeof rows) => {
    for (const r of rs) ins.run(from, r.scope, r.key, r.kwh, r.gpu_kwh ?? 0, r.avg_w, r.max_w, r.minutes)
  })
  tx(rows)
}

/**
 * Delete raw samples older than `olderThanTs` (seconds). Skips instantly when
 * nothing is stale (indexed MIN query), otherwise deletes in small chunks
 * between event-loop turns so the main process never blocks for long.
 */
export async function pruneSamples(olderThanTs: number): Promise<void> {
  const d = requireDb()
  const oldest = (d.prepare('SELECT MIN(ts) AS oldest FROM samples').get() as { oldest: number | null }).oldest
  if (oldest == null || oldest >= olderThanTs) return
  for (;;) {
    const boundary = (d.prepare('SELECT MAX(ts) AS ts FROM samples WHERE ts < ?').get(olderThanTs) as { ts: number | null }).ts
    if (boundary == null) break
    const info = d.prepare('DELETE FROM samples WHERE ts <= ?').run(boundary)
    if (info.changes === 0) break
    await new Promise((resolve) => setImmediate(resolve))
  }
}

// ---- Reads ----

/** Return rollups for [from, to) optionally filtered by scope, zero-filled. */
export function hourlyRange(
  from: Date,
  to: Date,
  scope: string
): HourlyRollup[] {
  const d = requireDb()
  const fromHour = Math.floor(from.getTime() / 1000)
  const toHour = Math.floor(to.getTime() / 1000)
  const rows = (
    scope
      ? d
          .prepare(
            `SELECT hour, scope, key, kwh, gpu_kwh, avg_w, max_w, minutes
             FROM hourly_rollups
             WHERE hour >= ? AND hour < ? AND scope = ?
             ORDER BY hour ASC, key ASC`
          )
          .all(fromHour, toHour, scope)
      : d
          .prepare(
            `SELECT hour, scope, key, kwh, gpu_kwh, avg_w, max_w, minutes
             FROM hourly_rollups
             WHERE hour >= ? AND hour < ?
             ORDER BY hour ASC, scope ASC, key ASC`
          )
          .all(fromHour, toHour)
  ) as { hour: number; scope: string; key: string; kwh: number; gpu_kwh: number; avg_w: number; max_w: number; minutes: number }[]

  return rows.map((r) => ({
    hour: new Date(r.hour * 1000).toISOString(),
    scope: r.scope,
    key: r.key,
    kWh: r.kwh,
    gpuKWh: r.gpu_kwh ?? 0,
    avgW: r.avg_w,
    maxW: r.max_w,
    minutes: r.minutes
  }))
}

/** Aggregate kWh and avgW per (scope, key) over [from, to). Sorted by kWh desc. */
export function totalsByKey(from: Date, to: Date, scope: string): KeyTotal[] {
  const d = requireDb()
  const fromSec = Math.floor(from.getTime() / 1000)
  const toSec = Math.floor(to.getTime() / 1000)
  if (toSec <= fromSec) return []
  const rows = (
    scope
      ? d
          .prepare(
            `SELECT scope, key,
                    SUM(kwh) AS kwh,
                    SUM(gpu_kwh) AS gpu_kwh,
                    SUM(avg_w * minutes) / NULLIF(SUM(minutes), 0) AS avg_w,
                    MAX(max_w) AS max_w
             FROM hourly_rollups
              WHERE hour >= ? AND hour < ? AND scope = ?
                AND (scope != 'process' OR (lower(key) != 'system idle process' AND lower(key) != '[gpu other]'))
             GROUP BY scope, key
             ORDER BY kwh DESC`
          )
          .all(fromSec, toSec, scope)
      : d
          .prepare(
            `SELECT scope, key,
                    SUM(kwh) AS kwh,
                    SUM(gpu_kwh) AS gpu_kwh,
                    SUM(avg_w * minutes) / NULLIF(SUM(minutes), 0) AS avg_w,
                    MAX(max_w) AS max_w
             FROM hourly_rollups
              WHERE hour >= ? AND hour < ?
                AND (scope != 'process' OR (lower(key) != 'system idle process' AND lower(key) != '[gpu other]'))
             GROUP BY scope, key
             ORDER BY kwh DESC`
          )
          .all(fromSec, toSec)
  ) as { scope: string; key: string; kwh: number; gpu_kwh: number; avg_w: number; max_w: number }[]

  return rows.map((r) => ({
    scope: r.scope,
    key: r.key,
    kWh: r.kwh,
    gpuKWh: r.gpu_kwh ?? 0,
    avgW: r.avg_w,
    maxW: r.max_w
  }))
}

/** Aggregate recent raw samples so short windows include the current hour. */
export function sampleTotalsByKey(from: Date, to: Date, scope: string): KeyTotal[] {
  const d = requireDb()
  const fromSec = Math.floor(from.getTime() / 1000)
  const toSec = Math.floor(to.getTime() / 1000)
  if (toSec <= fromSec) return []
  const rows = d.prepare(
    `SELECT scope, key,
            SUM(watts * interval_s) / 3600000.0 AS kwh,
            SUM(gpu_w * interval_s) / 3600000.0 AS gpu_kwh,
            SUM(watts * interval_s) / NULLIF(SUM(interval_s), 0) AS avg_w,
            MAX(watts) AS max_w
     FROM samples
     WHERE ts >= ? AND ts < ? AND scope = ?
       AND (scope != 'process' OR (lower(key) != 'system idle process' AND lower(key) != '[gpu other]'))
     GROUP BY scope, key
     ORDER BY kwh DESC`
  ).all(fromSec, toSec, scope) as { scope: string; key: string; kwh: number; gpu_kwh: number; avg_w: number; max_w: number }[]

  return rows.map((r) => ({
    scope: r.scope,
    key: r.key,
    kWh: r.kwh,
    gpuKWh: r.gpu_kwh ?? 0,
    avgW: r.avg_w,
    maxW: r.max_w
  }))
}

/** Full-window totals from hourly rollups plus the in-progress hour from raw
 *  samples. Rollups cover every completed hour (bounded by tracked hours, not
 *  sample rows), and the current hour never has a rollup, so nothing is
 *  double-counted. This keeps month-long queries fast even when the samples
 *  table holds millions of rows. */
export function totalsMerged(from: Date, to: Date, scope: string): KeyTotal[] {
  const rolled = totalsByKey(from, to, scope)
  const nowSec = Math.floor(Date.now() / 1000)
  const fromSec = Math.floor(from.getTime() / 1000)
  const partialStart = Math.max(fromSec, Math.floor(nowSec / 3600) * 3600)
  if (partialStart >= nowSec) return rolled

  const partial = sampleTotalsByKey(new Date(partialStart * 1000), new Date(nowSec * 1000), scope)
  if (partial.length === 0) return rolled

  const byKey = new Map<string, KeyTotal>()
  for (const r of rolled) byKey.set(r.key, r)
  for (const r of partial) {
    const existing = byKey.get(r.key)
    byKey.set(r.key, existing
      ? {
          scope: r.scope,
          key: r.key,
          kWh: existing.kWh + r.kWh,
          gpuKWh: existing.gpuKWh + r.gpuKWh,
          avgW: weightedAvg(existing, r),
          maxW: Math.max(existing.maxW, r.maxW)
        }
      : r)
  }
  return [...byKey.values()].sort((a, b) => b.kWh - a.kWh)
}

/** Minutes implied by a row, derived from its own kWh and avgW. */
function minutesOf(r: KeyTotal): number {
  return r.avgW > 0 ? (r.kWh * 60000) / r.avgW : 0
}

/** Interval-weighted average of two rows' avgW. */
function weightedAvg(a: KeyTotal, b: KeyTotal): number {
  const am = minutesOf(a)
  const bm = minutesOf(b)
  const total = am + bm
  if (total <= 0) return (a.avgW + b.avgW) / 2
  return (a.avgW * am + b.avgW * bm) / total
}

export interface StoreReadiness {
  latestSampleAt: number | null
  latestHourlyRollupAt: number | null
  hourlyBucketsAvailable: number
  processSamplesAvailable: boolean
}

export function getReadiness(windowDays: number): StoreReadiness {
  const d = requireDb()
  const from = Math.floor((Date.now() - windowDays * 24 * 3600 * 1000) / 3600000) * 3600
  const sample = d.prepare('SELECT MAX(ts) AS latest FROM samples').get() as { latest: number | null }
  const process = d.prepare("SELECT 1 AS present FROM samples WHERE scope = 'process' ORDER BY ts DESC LIMIT 1").get() as { present: number } | undefined
  const rollup = d.prepare('SELECT MAX(hour) AS latest, COUNT(DISTINCT hour) AS count FROM hourly_rollups WHERE scope = ? AND hour >= ?').get('component', from) as { latest: number | null; count: number }
  return {
    latestSampleAt: sample.latest ?? null,
    latestHourlyRollupAt: rollup.latest ?? null,
    hourlyBucketsAvailable: rollup.count ?? 0,
    processSamplesAvailable: !!process
  }
}

/** Timestamp (ISO) of the first tracked moment: raw samples when they still
 *  exist (48 h retention), otherwise the earliest hourly rollup. */
export function trackingStart(): string | null {
  const d = requireDb()
  const sample = d.prepare('SELECT MIN(ts) AS first FROM samples').get() as { first: number | null }
  const first = sample.first ?? (d.prepare('SELECT MIN(hour) AS first FROM hourly_rollups').get() as { first: number | null }).first
  return first == null ? null : new Date(first * 1000).toISOString()
}

export interface TrackingCoverage {
  firstTrackedAt: string | null
  lastTrackedAt: string | null
  /** Actual covered minutes (summed tracked time, not wall-clock span), in hours. */
  coveredHours: number
  /** Wall-clock hours in the window where the user was actually active
   *  (below the idle threshold), including the in-progress segment. */
  activeHours: number
}

/** How much actual tracked time the history represents. Rollups cover every
 *  completed hour; raw samples (48 h retention) cover the hour still in
 *  progress, so nothing is double-counted and on/off usage adds up. Pass
 *  `sinceSec` to bound the count to a window (e.g. the current month).
 *  Minutes are wall-clock time: per hour it's the MAX across component keys
 *  (any key sampling that hour means the hour was tracked once — summing per
 *  key would overcount ~5x), and the partial hour is the MAX of per-key sums.
 *  `activeHours` comes from the machine-state ledger (state='active'), plus
 *  the in-progress segment when `liveState` says the machine is active now —
 *  the ledger only flushes segments on transitions. */
export function trackingCoverage(sinceSec?: number, liveState?: MachineState): TrackingCoverage {
  const d = requireDb()
  const firstTrackedAt = trackingStart()
  if (!firstTrackedAt) {
    return { firstTrackedAt: null, lastTrackedAt: null, coveredHours: 0, activeHours: 0 }
  }

  const rollupMinutes = (d
    .prepare(
      "SELECT SUM(m) AS minutes FROM (SELECT MAX(minutes) AS m FROM hourly_rollups WHERE scope = 'component'" +
        (sinceSec != null ? ' AND hour >= ?' : '') +
        ' GROUP BY hour)'
    )
    .get(...(sinceSec != null ? [sinceSec] : [])) as { minutes: number | null }).minutes ?? 0

  const nowSec = Math.floor(Date.now() / 1000)
  const hourStart = Math.floor(nowSec / 3600) * 3600
  // The in-progress hour can never hold more than 60 minutes of real time;
  // clamp so uncapped sleep-gap intervals can't inflate coverage.
  const partialMinutes = Math.min(
    (d
      .prepare(
        "SELECT MAX(m) AS minutes FROM (SELECT SUM(interval_s) / 60.0 AS m FROM samples WHERE scope = 'component' AND ts >= ? AND ts < ?" +
          (sinceSec != null ? ' AND ts >= ?' : '') +
          ' GROUP BY key)'
      )
      .get(...(sinceSec != null ? [hourStart, nowSec, sinceSec] : [hourStart, nowSec])) as { minutes: number | null })
      .minutes ?? 0,
    60
  )

  // Closed 'active' segments overlapping the window, clamped to it.
  const activeMinutes = (d
    .prepare(
      `SELECT COALESCE(SUM(MIN(to_ts, ?) - MAX(from_ts, ?)), 0) AS minutes
       FROM machine_states
       WHERE state = 'active' AND from_ts < ? AND to_ts > ?`
    )
    .get(nowSec, sinceSec ?? 0, nowSec, sinceSec ?? 0) as { minutes: number }).minutes

  // Live tail: the in-progress segment isn't flushed until a transition, so
  // count from the last flushed end when the machine is active right now.
  // No flushed end means the ledger has never written (fresh install / all
  // sessions killed hard), so there is no tail to add.
  let liveActiveMinutes = 0
  if (liveState === 'active') {
    const lastEnd = lastMachineStateEnd()
    if (lastEnd != null) {
      const from = Math.max(lastEnd, sinceSec ?? 0)
      if (from < nowSec) liveActiveMinutes = nowSec - from
    }
  }

  const lastSample = d.prepare('SELECT MAX(ts) AS last FROM samples').get() as { last: number | null }
  const lastRollup = d.prepare('SELECT MAX(hour) AS last FROM hourly_rollups').get() as { last: number | null }
  const lastSec = Math.max(lastSample.last ?? 0, (lastRollup.last ?? 0) + 3600)

  return {
    firstTrackedAt,
    lastTrackedAt: lastSec > 0 ? new Date(lastSec * 1000).toISOString() : null,
    coveredHours: (rollupMinutes + partialMinutes) / 60,
    activeHours: (activeMinutes + liveActiveMinutes) / 3600
  }
}

export interface AllTimeStats extends TrackingCoverage {
  totalKWh: number
  avgW: number
}

/** All-time component usage from the first tracked sample to now. Rollups
 *  cover every completed hour; raw samples (48 h retention) cover the hour
 *  still in progress, so nothing is double-counted. Energy sums across
 *  component keys; minutes are wall-clock (per-hour MAX across keys), so
 *  avgW is a true average draw. `liveState` feeds the active-hours live
 *  tail (the in-progress ledger segment isn't flushed yet). */
export function allTimeComponentStats(liveState?: MachineState): AllTimeStats {
  const d = requireDb()
  const coverage = trackingCoverage(undefined, liveState)
  if (!coverage.firstTrackedAt) {
    return { ...coverage, totalKWh: 0, avgW: 0 }
  }

  const rollup = d
    .prepare(
      `SELECT (SELECT SUM(kwh) FROM hourly_rollups WHERE scope = 'component') AS kwh,
              (SELECT SUM(m) FROM (SELECT MAX(minutes) AS m FROM hourly_rollups WHERE scope = 'component' GROUP BY hour)) AS minutes`
    )
    .get() as { kwh: number | null; minutes: number | null }

  const nowSec = Math.floor(Date.now() / 1000)
  const hourStart = Math.floor(nowSec / 3600) * 3600
  const partial = d
    .prepare(
      `SELECT (SELECT SUM(watts * interval_s) / 3600000.0 FROM samples WHERE scope = 'component' AND ts >= ? AND ts < ?) AS kwh,
              (SELECT MAX(m) FROM (SELECT SUM(interval_s) / 60.0 AS m FROM samples WHERE scope = 'component' AND ts >= ? AND ts < ? GROUP BY key)) AS minutes`
    )
    .get(hourStart, nowSec, hourStart, nowSec) as { kwh: number | null; minutes: number | null }

  const totalKWh = (rollup.kwh ?? 0) + (partial.kwh ?? 0)
  const minutes = (rollup.minutes ?? 0) + (partial.minutes ?? 0)

  return {
    ...coverage,
    totalKWh,
    avgW: minutes > 0 ? (totalKWh * 60000) / minutes : 0
  }
}

// ---- Machine states ----

export function insertMachineState(fromMs: number, toMs: number, state: MachineState, avgW: number, kWh: number): void {
  const d = requireDb()
  d.prepare('INSERT INTO machine_states (from_ts, to_ts, state, avg_w, kwh) VALUES (?, ?, ?, ?, ?)').run(
    Math.floor(fromMs / 1000),
    Math.floor(toMs / 1000),
    state,
    avgW,
    kWh
  )
}

/** End timestamp of the last recorded segment (seconds epoch), or null. */
export function lastMachineStateEnd(): number | null {
  const d = requireDb()
  const row = d.prepare('SELECT MAX(to_ts) AS last FROM machine_states').get() as { last: number | null }
  return row.last
}

export function machineStateRange(from: Date, to: Date): MachineStateRow[] {
  const d = requireDb()
  const fromSec = Math.floor(from.getTime() / 1000)
  const toSec = Math.floor(to.getTime() / 1000)
  const rows = d
    .prepare(
      `SELECT from_ts, to_ts, state, avg_w, kwh
       FROM machine_states
       WHERE from_ts >= ? AND from_ts < ?
       ORDER BY from_ts ASC`
    )
    .all(fromSec, toSec) as { from_ts: number; to_ts: number; state: string; avg_w: number; kwh: number }[]
  return rows.map((r) => ({
    from: new Date(r.from_ts * 1000).toISOString(),
    to: new Date(r.to_ts * 1000).toISOString(),
    state: r.state as MachineState,
    avgW: r.avg_w,
    kWh: r.kwh
  }))
}

/** Aggregate kWh + weighted avg W per state over [from, to). */
export function machineStateTotals(from: Date, to: Date): { state: MachineState; kWh: number; avgW: number }[] {
  const d = requireDb()
  const fromSec = Math.floor(from.getTime() / 1000)
  const toSec = Math.floor(to.getTime() / 1000)
  const rows = d
    .prepare(
      `SELECT state,
              SUM(kwh) AS kwh,
              SUM(avg_w * (to_ts - from_ts)) / NULLIF(SUM(to_ts - from_ts), 0) AS avg_w
       FROM machine_states
       WHERE from_ts >= ? AND from_ts < ?
       GROUP BY state`
    )
    .all(fromSec, toSec) as { state: string; kwh: number; avg_w: number | null }[]
  return rows.map((r) => ({
    state: r.state as MachineState,
    kWh: r.kwh,
    avgW: r.avg_w ?? 0
  }))
}

export async function pruneMachineStates(olderThanTs: number): Promise<void> {
  const d = requireDb()
  const oldest = (d.prepare('SELECT MIN(from_ts) AS oldest FROM machine_states').get() as { oldest: number | null }).oldest
  if (oldest == null || oldest >= olderThanTs) return
  for (;;) {
    const boundary = (d.prepare('SELECT MAX(from_ts) AS ts FROM machine_states WHERE from_ts < ?').get(olderThanTs) as { ts: number | null }).ts
    if (boundary == null) break
    const info = d.prepare('DELETE FROM machine_states WHERE from_ts <= ?').run(boundary)
    if (info.changes === 0) break
    await new Promise((resolve) => setImmediate(resolve))
  }
}

// ---- Sleep mode sessions ----

export function insertSleepSession(
  startMs: number,
  endMs: number,
  avgW: number,
  baselineW: number,
  kWh: number,
  savedKWh: number,
  throttledCount: number
): void {
  const d = requireDb()
  d.prepare(
    'INSERT INTO sleep_sessions (start_ts, end_ts, avg_w, baseline_w, kwh, saved_kwh, throttled_count) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    Math.floor(startMs / 1000),
    Math.floor(endMs / 1000),
    avgW,
    baselineW,
    kWh,
    savedKWh,
    throttledCount
  )
}

export function sleepSessions(from: Date, to: Date): SleepSession[] {
  const d = requireDb()
  const rows = d
    .prepare(
      `SELECT start_ts, end_ts, avg_w, baseline_w, kwh, saved_kwh, throttled_count
       FROM sleep_sessions
       WHERE start_ts >= ? AND start_ts < ?
       ORDER BY start_ts ASC`
    )
    .all(Math.floor(from.getTime() / 1000), Math.floor(to.getTime() / 1000)) as {
    start_ts: number
    end_ts: number
    avg_w: number
    baseline_w: number
    kwh: number
    saved_kwh: number
    throttled_count: number
  }[]
  return rows.map((r) => ({
    start: new Date(r.start_ts * 1000).toISOString(),
    end: new Date(r.end_ts * 1000).toISOString(),
    avgW: r.avg_w,
    baselineW: r.baseline_w,
    kWh: r.kwh,
    savedKWh: r.saved_kwh,
    throttledCount: r.throttled_count
  }))
}
