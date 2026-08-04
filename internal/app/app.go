// Package app is the binding layer. It is a thin façade over
// the service: it holds the Wails context, routes events, and
// exposes typed methods to the frontend.
package app

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/richmondgoh8/wattprint/internal/collector"
	"github.com/richmondgoh8/wattprint/internal/config"
	"github.com/richmondgoh8/wattprint/internal/forecast"
	"github.com/richmondgoh8/wattprint/internal/service"
	"github.com/richmondgoh8/wattprint/internal/store"
)

// App is the Wails binding root.
type App struct {
	Cfg *config.Store
	St  *store.Store
	Svc *service.Service

	ctx       context.Context
	startOnce sync.Once
}

// New constructs the binding layer. The collector/service are
// created lazily on first Start so that Wails dev rebuilds work.
func New(cfg *config.Store, st *store.Store) *App {
	a := &App{Cfg: cfg, St: st}
	a.Svc = service.New(cfg, st, a) // self implements Emitter
	return a
}

// Startup is called by Wails once the window is ready.
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
}

// Shutdown is called by Wails when the window is closing.
func (a *App) Shutdown(ctx context.Context) {
	a.Svc.Stop()
	_ = a.St.Close()
}

// ---------- Emitter (called by the service) ----------

// EmitSample pushes a 1s snapshot to the frontend.
func (a *App) EmitSample(s collector.Snapshot) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "sample", s)
}

// EmitStatus pushes a status string to the frontend.
func (a *App) EmitStatus(s string) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "status", s)
}

// ---------- Methods exposed to the frontend ----------

// Start begins the background sampling and rollup loops.
func (a *App) Start() error {
	if a.ctx == nil {
		return fmt.Errorf("app not started")
	}
	var err error
	a.startOnce.Do(func() { err = a.Svc.Start(a.ctx) })
	return err
}

// GetSettings returns the current user settings.
func (a *App) GetSettings() config.Settings { return a.Cfg.Get() }

// UpdateSettings applies a partial update to the user settings.
// Accepts a config.Settings; zero-valued fields are ignored so the
// frontend can PATCH-style update.
func (a *App) UpdateSettings(s config.Settings) error {
	return a.Cfg.Update(func(cur *config.Settings) {
		if s.CostPerKWh > 0 {
			cur.CostPerKWh = s.CostPerKWh
		}
		if s.Currency != "" {
			cur.Currency = s.Currency
		}
		if s.GridCarbonIntensity > 0 {
			cur.GridCarbonIntensity = s.GridCarbonIntensity
		}
		if s.ForecastWindowDays > 0 {
			cur.ForecastWindowDays = s.ForecastWindowDays
		}
		if s.SampleIntervalSeconds > 0 {
			cur.SampleIntervalSeconds = s.SampleIntervalSeconds
		}
		if s.Theme != "" {
			cur.Theme = s.Theme
		}
		cur.StartOnLogin = s.StartOnLogin
	})
}

// ViewTotals is the payload for the "All Devices" view.
func (a *App) ViewTotals(from, to time.Time, scope string) ([]store.KeyTotal, error) {
	if a.ctx == nil {
		return nil, fmt.Errorf("app not started")
	}
	switch scope {
	case "component":
		return a.Svc.ComponentTotals(a.ctx, from, to)
	case "process":
		return a.Svc.ProcessTotals(a.ctx, from, to)
	default:
		return nil, fmt.Errorf("scope must be 'component' or 'process'")
	}
}

// ViewHourly is the payload for the "Hourly Average" chart.
func (a *App) ViewHourly(from, to time.Time, scope, key string) ([]store.HourlyRollup, error) {
	if a.ctx == nil {
		return nil, fmt.Errorf("app not started")
	}
	switch scope {
	case "component":
		return a.Svc.ComponentHourly(a.ctx, from, to, key)
	case "process":
		return a.Svc.ProcessHourly(a.ctx, from, to, key)
	default:
		return nil, fmt.Errorf("scope must be 'component' or 'process'")
	}
}

// ViewForecast returns the projected monthly kWh and cost.
func (a *App) ViewForecast() (forecast.Result, error) {
	if a.ctx == nil {
		return forecast.Result{}, fmt.Errorf("app not started")
	}
	return a.Svc.Forecast(a.ctx)
}
