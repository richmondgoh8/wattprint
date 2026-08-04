// Package store is the SQLite repository layer. One writer, many readers,
// in WAL mode. Schema is created on open and migrated forward.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// Sample is a single 1s snapshot. One row per component or per process.
type Sample struct {
	Timestamp time.Time `json:"ts"`
	Scope     string    `json:"scope"` // "component" | "process"
	Key       string    `json:"key"`   // "cpu","gpu","ram","disk","net" for component; exe name for process
	Watts     float64   `json:"w"`
}

// HourlyRollup is the per-hour aggregate over all samples in an hour bucket.
// One row per (scope, key, hour). Maintained by RollupHour.
type HourlyRollup struct {
	Hour    time.Time `json:"hour"` // truncated to hour
	Scope   string    `json:"scope"`
	Key     string    `json:"key"`
	KWh     float64   `json:"kWh"`
	AvgW    float64   `json:"avgW"`
	MaxW    float64   `json:"maxW"`
	Minutes float64   `json:"minutes"` // duration covered by samples (can be < 60)
}

// Store wraps a single SQLite database.
type Store struct {
	db *sql.DB
}

// Open opens (or creates) the wattprint database in the given directory.
// PRAGMA journal_mode=WAL, synchronous=NORMAL, foreign_keys=ON.
func Open(dir string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)&_pragma=busy_timeout(5000)",
		filepath.Join(dir, "wattprint.db"))
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	if err := db.PingContext(context.Background()); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

// Close closes the database. Safe to call multiple times.
func (s *Store) Close() error {
	if s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) migrate() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS samples (
			ts      INTEGER NOT NULL,
			scope   TEXT    NOT NULL,
			key     TEXT    NOT NULL,
			watts   REAL    NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_samples_ts    ON samples(ts)`,
		`CREATE INDEX IF NOT EXISTS idx_samples_key   ON samples(scope, key, ts)`,

		`CREATE TABLE IF NOT EXISTS hourly_rollups (
			hour     INTEGER NOT NULL,
			scope    TEXT    NOT NULL,
			key      TEXT    NOT NULL,
			kwh      REAL    NOT NULL,
			avg_w    REAL    NOT NULL,
			max_w    REAL    NOT NULL,
			minutes  REAL    NOT NULL,
			PRIMARY KEY (hour, scope, key)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_rollups_key ON hourly_rollups(scope, key, hour)`,
	}
	for _, q := range stmts {
		if _, err := s.db.Exec(q); err != nil {
			return fmt.Errorf("schema %q: %w", q[:40], err)
		}
	}
	return nil
}

// WriteSamples inserts a batch of samples in a single transaction.
// Empty input is a no-op.
func (s *Store) WriteSamples(ctx context.Context, batch []Sample) error {
	if len(batch) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO samples(ts, scope, key, watts) VALUES (?, ?, ?, ?)`)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	defer stmt.Close()
	for _, s := range batch {
		if _, err := stmt.ExecContext(ctx, s.Timestamp.Unix(), s.Scope, s.Key, s.Watts); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// RollupHour aggregates the samples within the given hour (UTC) into the
// hourly_rollups table. Safe to call repeatedly; replaces the row if present.
func (s *Store) RollupHour(ctx context.Context, hour time.Time) error {
	hour = hour.UTC().Truncate(time.Hour)
	from := hour.Unix()
	to := from + 3600

	_, err := s.db.ExecContext(ctx, `DELETE FROM hourly_rollups WHERE hour = ?`, from)
	if err != nil {
		return err
	}

	// For each (scope, key), compute kWh, avg W, max W, minutes covered.
	// kWh is the time integral of power: sum(watts * dt) / 3_600_000
	// but we don't have per-row dt in samples; assume 1s for simplicity
	// (the collector writes one sample per second per key).
	const secondsPerSample = 1.0

	rows, err := s.db.QueryContext(ctx, `
		SELECT scope, key,
		       SUM(watts) * ? / 3_600_000.0        AS kwh,
		       AVG(watts)                          AS avg_w,
		       MAX(watts)                          AS max_w,
		       COUNT(*) * ? / 60.0                 AS minutes
		FROM samples
		WHERE ts >= ? AND ts < ?
		GROUP BY scope, key
	`, secondsPerSample, secondsPerSample, from, to)
	if err != nil {
		return err
	}
	defer rows.Close()

	type row struct {
		scope                          string
		key                            string
		kwh, avg, mx, minutes          float64
	}
	var rs []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.scope, &r.key, &r.kwh, &r.avg, &r.mx, &r.minutes); err != nil {
			return err
		}
		rs = append(rs, r)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(rs) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO hourly_rollups(hour, scope, key, kwh, avg_w, max_w, minutes)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	defer stmt.Close()
	for _, r := range rs {
		if _, err := stmt.ExecContext(ctx, from, r.scope, r.key, r.kwh, r.avg, r.mx, r.minutes); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// HourlyRange returns rollups between [from, to) optionally filtered by scope.
// Scope="" returns all scopes.
func (s *Store) HourlyRange(ctx context.Context, from, to time.Time, scope string) ([]HourlyRollup, error) {
	from = from.UTC().Truncate(time.Hour)
	to = to.UTC().Truncate(time.Hour)
	if to.Before(from) || to.Equal(from) {
		return nil, nil
	}

	var (
		rows *sql.Rows
		err  error
	)
	if scope == "" {
		rows, err = s.db.QueryContext(ctx, `
			SELECT hour, scope, key, kwh, avg_w, max_w, minutes
			FROM hourly_rollups
			WHERE hour >= ? AND hour < ?
			ORDER BY hour ASC, scope ASC, key ASC
		`, from.Unix(), to.Unix())
	} else {
		rows, err = s.db.QueryContext(ctx, `
			SELECT hour, scope, key, kwh, avg_w, max_w, minutes
			FROM hourly_rollups
			WHERE hour >= ? AND hour < ? AND scope = ?
			ORDER BY hour ASC, key ASC
		`, from.Unix(), to.Unix(), scope)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []HourlyRollup
	for rows.Next() {
		var (
			hourUnix                                                int64
			hr                                                      HourlyRollup
		)
		if err := rows.Scan(&hourUnix, &hr.Scope, &hr.Key, &hr.KWh, &hr.AvgW, &hr.MaxW, &hr.Minutes); err != nil {
			return nil, err
		}
		hr.Hour = time.Unix(hourUnix, 0).UTC()
		out = append(out, hr)
	}
	return out, rows.Err()
}

// RangeByKey aggregates across a time window, returning one row per (scope, key).
// Used by All Devices and Top Consumers views.
type KeyTotal struct {
	Scope string  `json:"scope"`
	Key   string  `json:"key"`
	KWh   float64 `json:"kWh"`
	AvgW  float64 `json:"avgW"`
	MaxW  float64 `json:"maxW"`
}

// TotalsByKey returns the aggregated kWh and avg W per (scope, key) over [from, to).
// Sorted descending by kWh.
func (s *Store) TotalsByKey(ctx context.Context, from, to time.Time, scope string) ([]KeyTotal, error) {
	from = from.UTC()
	to = to.UTC()
	if !to.After(from) {
		return nil, nil
	}

	var (
		rows *sql.Rows
		err  error
	)
	if scope == "" {
		rows, err = s.db.QueryContext(ctx, `
			SELECT scope, key,
			       SUM(kwh)        AS kwh,
			       SUM(avg_w * minutes) / NULLIF(SUM(minutes), 0) AS avg_w,
			       MAX(max_w)      AS max_w
			FROM hourly_rollups
			WHERE hour >= ? AND hour < ?
			GROUP BY scope, key
			ORDER BY kwh DESC
		`, from.Unix(), to.Unix())
	} else {
		rows, err = s.db.QueryContext(ctx, `
			SELECT scope, key,
			       SUM(kwh)        AS kwh,
			       SUM(avg_w * minutes) / NULLIF(SUM(minutes), 0) AS avg_w,
			       MAX(max_w)      AS max_w
			FROM hourly_rollups
			WHERE hour >= ? AND hour < ? AND scope = ?
			GROUP BY scope, key
			ORDER BY kwh DESC
		`, from.Unix(), to.Unix(), scope)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []KeyTotal
	for rows.Next() {
		var kt KeyTotal
		if err := rows.Scan(&kt.Scope, &kt.Key, &kt.KWh, &kt.AvgW, &kt.MaxW); err != nil {
			return nil, err
		}
		out = append(out, kt)
	}
	return out, rows.Err()
}

// HourlyByKey returns rollups for one (scope, key) over [from, to), filling
// missing hours with zeros so the chart has a continuous time axis.
func (s *Store) HourlyByKey(ctx context.Context, from, to time.Time, scope, key string) ([]HourlyRollup, error) {
	all, err := s.HourlyRange(ctx, from, to, scope)
	if err != nil {
		return nil, err
	}
	index := make(map[time.Time]HourlyRollup, len(all))
	for _, r := range all {
		if r.Key == key {
			index[r.Hour] = r
		}
	}
	out := make([]HourlyRollup, 0, 24)
	for h := from.UTC().Truncate(time.Hour); h.Before(to); h = h.Add(time.Hour) {
		if r, ok := index[h]; ok {
			out = append(out, r)
		} else {
			out = append(out, HourlyRollup{Hour: h, Scope: scope, Key: key})
		}
	}
	return out, nil
}

// ErrNoData is returned when a query has no usable data.
var ErrNoData = errors.New("no data")

// OldestSample returns the timestamp of the oldest sample, or ErrNoData if empty.
func (s *Store) OldestSample(ctx context.Context) (time.Time, error) {
	var ts int64
	err := s.db.QueryRowContext(ctx, `SELECT MIN(ts) FROM samples`).Scan(&ts)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return time.Time{}, ErrNoData
		}
		return time.Time{}, err
	}
	if ts == 0 {
		return time.Time{}, ErrNoData
	}
	return time.Unix(ts, 0).UTC(), nil
}
