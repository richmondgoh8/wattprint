// Package service is the domain layer. It owns the sampling loop,
// the hourly rollup loop, and the queries used by the views.
// It knows nothing about Wails; events are emitted via Emitter.
package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/richmondgoh8/wattprint/internal/collector"
	"github.com/richmondgoh8/wattprint/internal/config"
	"github.com/richmondgoh8/wattprint/internal/forecast"
	"github.com/richmondgoh8/wattprint/internal/store"
)

// Emitter is the Wails event sink. Implemented in the app layer.
type Emitter interface {
	EmitSample(s collector.Snapshot)
	EmitStatus(s string)
}

// Service is the top-level domain object.
type Service struct {
	Cfg *config.Store
	St  *store.Store
	Col *collector.Collector
	Fc  *forecast.Engine
	Em  Emitter

	mu     sync.Mutex
	cancel context.CancelFunc
}

// New constructs a service. The collector and forecast engine share
// the store with the rest of the app.
func New(cfg *config.Store, st *store.Store, em Emitter) *Service {
	return &Service{
		Cfg: cfg,
		St:  st,
		Col: collector.New(collector.Options{}),
		Fc:  forecast.New(st),
		Em:  em,
	}
}

// Start begins the sampling and rollup loops in background goroutines.
// Calling Start more than once is a no-op.
func (s *Service) Start(ctx context.Context) error {
	s.mu.Lock()
	if s.cancel != nil {
		s.mu.Unlock()
		return nil
	}
	c, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	s.mu.Unlock()

	s.Em.EmitStatus("starting collector…")
	go s.sampleLoop(c)
	go s.rollupLoop(c)
	return nil
}

// Stop halts the background loops. Safe to call multiple times.
func (s *Service) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}
}

func (s *Service) sampleLoop(ctx context.Context) {
	interval := time.Duration(s.Cfg.Get().SampleIntervalSeconds) * time.Second
	if interval < time.Second {
		interval = time.Second
	}
	t := time.NewTicker(interval)
	defer t.Stop()

	// Prime the collector (first sample has CPU%=0 by design).
	_, _ = s.Col.Sample(ctx)
	s.Em.EmitStatus("collecting…")

	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			snap, err := s.Col.Sample(ctx)
			if err != nil {
				s.Em.EmitStatus("collect error: " + err.Error())
				continue
			}
			s.persist(ctx, snap)
			s.Em.EmitSample(snap)
		}
	}
}

func (s *Service) persist(ctx context.Context, snap collector.Snapshot) {
	batch := make([]store.Sample, 0, len(snap.Components)+len(snap.Processes))
	for k, w := range snap.Components {
		batch = append(batch, store.Sample{
			Timestamp: snap.Timestamp,
			Scope:     "component",
			Key:       k,
			Watts:     w,
		})
	}
	for _, p := range snap.Processes {
		if p.TotalW <= 0 {
			continue
		}
		batch = append(batch, store.Sample{
			Timestamp: snap.Timestamp,
			Scope:     "process",
			Key:       p.Name,
			Watts:     p.TotalW,
		})
	}
	if err := s.St.WriteSamples(ctx, batch); err != nil {
		s.Em.EmitStatus("store error: " + err.Error())
	}
}

// rollupLoop runs once an hour and rolls up the previous hour.
func (s *Service) rollupLoop(ctx context.Context) {
	// Run once on start to roll up the just-finished hour (in case Wattprint
	// was off for a while).
	s.rollupPreviousHour(ctx)

	t := time.NewTicker(15 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			// Roll up the most recently-completed hour if it hasn't been yet.
			if now.Minute() < 5 {
				s.rollupPreviousHour(ctx)
			}
		}
	}
}

func (s *Service) rollupPreviousHour(ctx context.Context) {
	hour := time.Now().UTC().Truncate(time.Hour)
	if err := s.St.RollupHour(ctx, hour); err != nil {
		s.Em.EmitStatus("rollup error: " + err.Error())
	}
}

// ---- Queries used by the app layer ----

// ComponentTotals returns aggregated kWh per component over [from, to).
func (s *Service) ComponentTotals(ctx context.Context, from, to time.Time) ([]store.KeyTotal, error) {
	return s.St.TotalsByKey(ctx, from, to, "component")
}

// ProcessTotals returns aggregated kWh per process over [from, to).
func (s *Service) ProcessTotals(ctx context.Context, from, to time.Time) ([]store.KeyTotal, error) {
	return s.St.TotalsByKey(ctx, from, to, "process")
}

// ComponentHourly returns the per-hour kWh for one component, zero-filled.
func (s *Service) ComponentHourly(ctx context.Context, from, to time.Time, key string) ([]store.HourlyRollup, error) {
	return s.St.HourlyByKey(ctx, from, to, "component", key)
}

// ProcessHourly returns the per-hour kWh for one process, zero-filled.
func (s *Service) ProcessHourly(ctx context.Context, from, to time.Time, key string) ([]store.HourlyRollup, error) {
	return s.St.HourlyByKey(ctx, from, to, "process", key)
}

// Forecast returns the projected monthly kWh and cost.
func (s *Service) Forecast(ctx context.Context) (forecast.Result, error) {
	cfg := s.Cfg.Get()
	if cfg.ForecastWindowDays <= 0 {
		return forecast.Result{}, fmt.Errorf("forecastWindowDays must be > 0")
	}
	return s.Fc.Compute(ctx, cfg.ForecastWindowDays, cfg.CostPerKWh, cfg.GridCarbonIntensity, cfg.Currency)
}
