// SQLite repository. better-sqlite3 (sync API, very fast).
// Same schema as internal/store/store.go in the Wails version.
// One file: <userData>/wattprint.db, WAL mode.

import BetterSqlite3, { type Database } from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import type { KeyTotal, HourlyRollup, Snapshot, ProcessSample } from '../shared/types.js'

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
      watts REAL    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_samples_ts  ON samples(ts);
    CREATE INDEX IF NOT EXISTS idx_samples_key ON samples(scope, key, ts);

    CREATE TABLE IF NOT EXISTS hourly_rollups (
      hour    INTEGER NOT NULL,
      scope   TEXT    NOT NULL,
      key     TEXT    NOT NULL,
      kwh     REAL    NOT NULL,
      avg_w   REAL    NOT NULL,
      max_w   REAL    NOT NULL,
      minutes REAL    NOT NULL,
      PRIMARY KEY (hour, scope, key)
    );
    CREATE INDEX IF NOT EXISTS idx_rollups_key ON hourly_rollups(scope, key, hour);

    CREATE TABLE IF NOT EXISTS schema_version (
      id      INTEGER PRIMARY KEY,
      version INTEGER NOT NULL
    );
  `)

  // Schema migrations. Each migration is idempotent: it only runs if the
  // recorded version is less than the target. We use a single version row
  // keyed by id=0, so we can use INSERT OR REPLACE for a clean upsert.
  const SCHEMA_ID = 0
  db.prepare('INSERT OR IGNORE INTO schema_version(version) VALUES (?)').run(SCHEMA_ID)
  const current =
    (db.prepare('SELECT version FROM schema_version WHERE rowid = ?').get(SCHEMA_ID) as
      | { version: number }
      | undefined)?.version ?? 0

  if (current < 2) {
    // v2: nuke historical samples + rollups. Reason: the v0.1 disk estimator
    // had a units bug that wrote values like 6.8 MW to the DB. We've fixed
    // it, but the bad rows are still in storage. Wipe once; future writes
    // are correct.
    db.exec('DELETE FROM samples; DELETE FROM hourly_rollups;')
    db.prepare('UPDATE schema_version SET version = ? WHERE rowid = ?').run(2, SCHEMA_ID)
  }
}

export function closeStore(): void {
  if (db) {
    db.close()
    db = null
  }
}

function requireDb(): Database {
  if (!db) throw new Error('store not initialized')
  return db
}

// ---- Writes ----

/** Insert a batch of 1-second samples in a single transaction. */
export function writeSamples(samples: { ts: Date; scope: string; key: string; watts: number }[]): void {
  if (samples.length === 0) return
  const d = requireDb()
  const stmt = d.prepare('INSERT INTO samples (ts, scope, key, watts) VALUES (?, ?, ?, ?)')
  const tx = d.transaction((rows: typeof samples) => {
    for (const s of rows) stmt.run(Math.floor(s.ts.getTime() / 1000), s.scope, s.key, s.watts)
  })
  tx(samples)
}

/** Compute the hourly rollup for the given hour and replace existing rows. */
export function rollupHour(hour: Date): void {
  const d = requireDb()
  const from = Math.floor(hour.getTime() / 1000)
  const to = from + 3600
  d.prepare('DELETE FROM hourly_rollups WHERE hour = ?').run(from)

  // Aggregate per (scope, key). kWh assumes 1-second samples:
  // kWh = sum(watts) * 1s / 3,600,000 = sum(watts) / 3,600,000
  const rows = d
    .prepare(
      `SELECT scope, key,
              SUM(watts) / 3600000.0 AS kwh,
              AVG(watts)              AS avg_w,
              MAX(watts)              AS max_w,
              COUNT(*) * 1.0 / 60.0   AS minutes
       FROM samples
       WHERE ts >= ? AND ts < ?
       GROUP BY scope, key`
    )
    .all(from, to) as { scope: string; key: string; kwh: number; avg_w: number; max_w: number; minutes: number }[]

  if (rows.length === 0) return

  const ins = d.prepare(
    'INSERT INTO hourly_rollups (hour, scope, key, kwh, avg_w, max_w, minutes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  const tx = d.transaction((rs: typeof rows) => {
    for (const r of rs) ins.run(from, r.scope, r.key, r.kwh, r.avg_w, r.max_w, r.minutes)
  })
  tx(rows)
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
            `SELECT hour, scope, key, kwh, avg_w, max_w, minutes
             FROM hourly_rollups
             WHERE hour >= ? AND hour < ? AND scope = ?
             ORDER BY hour ASC, key ASC`
          )
          .all(fromHour, toHour, scope)
      : d
          .prepare(
            `SELECT hour, scope, key, kwh, avg_w, max_w, minutes
             FROM hourly_rollups
             WHERE hour >= ? AND hour < ?
             ORDER BY hour ASC, scope ASC, key ASC`
          )
          .all(fromHour, toHour)
  ) as { hour: number; scope: string; key: string; kwh: number; avg_w: number; max_w: number; minutes: number }[]

  return rows.map((r) => ({
    hour: new Date(r.hour * 1000).toISOString(),
    scope: r.scope,
    key: r.key,
    kWh: r.kwh,
    avgW: r.avg_w,
    maxW: r.max_w,
    minutes: r.minutes
  }))
}

/** Per-hour rollup for one (scope, key) over [from, to), zero-filled. */
export function hourlyByKey(
  from: Date,
  to: Date,
  scope: string,
  key: string
): HourlyRollup[] {
  const all = hourlyRange(from, to, scope)
  const byHour = new Map<number, HourlyRollup>()
  for (const r of all) {
    if (r.key === key) byHour.set(Math.floor(new Date(r.hour).getTime() / 1000), r)
  }
  const out: HourlyRollup[] = []
  for (let t = Math.floor(from.getTime() / 1000); t < to.getTime() / 1000; t += 3600) {
    const found = byHour.get(t)
    if (found) out.push(found)
    else
      out.push({
        hour: new Date(t * 1000).toISOString(),
        scope,
        key,
        kWh: 0,
        avgW: 0,
        maxW: 0,
        minutes: 0
      })
  }
  return out
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
                    SUM(avg_w * minutes) / NULLIF(SUM(minutes), 0) AS avg_w,
                    MAX(max_w) AS max_w
             FROM hourly_rollups
             WHERE hour >= ? AND hour < ? AND scope = ?
             GROUP BY scope, key
             ORDER BY kwh DESC`
          )
          .all(fromSec, toSec, scope)
      : d
          .prepare(
            `SELECT scope, key,
                    SUM(kwh) AS kwh,
                    SUM(avg_w * minutes) / NULLIF(SUM(minutes), 0) AS avg_w,
                    MAX(max_w) AS max_w
             FROM hourly_rollups
             WHERE hour >= ? AND hour < ?
             GROUP BY scope, key
             ORDER BY kwh DESC`
          )
          .all(fromSec, toSec)
  ) as { scope: string; key: string; kwh: number; avg_w: number; max_w: number }[]

  return rows.map((r) => ({
    scope: r.scope,
    key: r.key,
    kWh: r.kwh,
    avgW: r.avg_w,
    maxW: r.max_w
  }))
}
