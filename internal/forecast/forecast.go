// Package forecast projects monthly energy use and cost from historical samples.
// v0.1 uses a simple trailing-window average; v0.2 will add time-of-day weighting.
package forecast

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/richmondgoh8/wattprint/internal/store"
)

// Result is the projected outcome of a forecast.
type Result struct {
	WindowDays         int       `json:"windowDays"`
	WindowStart        time.Time `json:"windowStart"`
	WindowEnd          time.Time `json:"windowEnd"`
	HoursCovered       float64   `json:"hoursCovered"`
	KWhInWindow        float64   `json:"kWhInWindow"`
	AvgKWhPerHour      float64   `json:"avgKWhPerHour"`
	StdDevKWhPerHour   float64   `json:"stdDevKWhPerHour"`
	ProjectedKWhPerDay float64   `json:"projectedKWhPerDay"`
	ProjectedKWhMonth  float64   `json:"projectedKWhMonth"`
	ProjectedCostMonth float64   `json:"projectedCostMonth"`
	ProjectedCO2Kg     float64   `json:"projectedCO2Kg"`
	Currency           string    `json:"currency"`
	CostPerKWh         float64   `json:"costPerKWh"`
	GridCarbonGCO2KWh  float64   `json:"gridCarbonGCO2PerKWh"`
	LowKWhMonth        float64   `json:"lowKWhMonth"`
	HighKWhMonth       float64   `json:"highKWhMonth"`
	LowCostMonth       float64   `json:"lowCostMonth"`
	HighCostMonth      float64   `json:"highCostMonth"`
	HasEnoughData      bool      `json:"hasEnoughData"`
}

// Engine computes forecasts against a store.
type Engine struct {
	St *store.Store
}

// New returns a forecast engine backed by the given store.
func New(st *store.Store) *Engine { return &Engine{St: st} }

// Compute returns a Result for the given window length, cost and grid intensity.
// "HasEnoughData" is false if the window contains < 6 hours of actual samples,
// in which case the projected values are still returned but marked untrustworthy.
func (e *Engine) Compute(ctx context.Context, windowDays int, costPerKWh, gridGCO2 float64, currency string) (Result, error) {
	if windowDays < 1 {
		windowDays = 1
	}
	if windowDays > 365 {
		windowDays = 365
	}
	now := time.Now().UTC()
	endHour := now.Truncate(time.Hour).Add(time.Hour) // exclusive
	startHour := endHour.Add(-time.Duration(windowDays) * 24 * time.Hour)

	rolls, err := e.St.HourlyRange(ctx, startHour, endHour, "")
	if err != nil {
		return Result{}, fmt.Errorf("hourly range: %w", err)
	}

	// Aggregate per-hour total kWh across all keys (system-wide total).
	perHour := make(map[time.Time]float64, windowDays*24)
	for _, r := range rolls {
		perHour[r.Hour] += r.KWh
	}
	// Continuous hour list, zero-filling missing hours.
	values := make([]float64, 0, windowDays*24)
	totalKWh := 0.0
	for h := startHour; h.Before(endHour); h = h.Add(time.Hour) {
		v := perHour[h]
		values = append(values, v)
		totalKWh += v
	}
	hoursCovered := float64(len(values))
	avgKWhPerHour := 0.0
	if hoursCovered > 0 {
		avgKWhPerHour = totalKWh / hoursCovered
	}

	// Sample std dev (n-1).
	stdDev := 0.0
	if hoursCovered > 1 {
		var sumSq float64
		for _, v := range values {
			d := v - avgKWhPerHour
			sumSq += d * d
		}
		stdDev = math.Sqrt(sumSq / (hoursCovered - 1))
	}

	// Monthly projection = avgKWhPerHour * 24h * 30d.
	const daysInMonth = 30
	projKWhPerDay := avgKWhPerHour * 24
	projKWhMonth := avgKWhPerHour * 24 * daysInMonth
	projCost := projKWhMonth * costPerKWh
	projCO2 := projKWhMonth * gridGCO2 / 1000.0 // g -> kg

	// 1-sigma confidence band on the monthly total.
	sigmaMonth := stdDev * 24 * daysInMonth
	lowKWh := math.Max(0, projKWhMonth-sigmaMonth)
	highKWh := projKWhMonth + sigmaMonth

	res := Result{
		WindowDays:         windowDays,
		WindowStart:        startHour,
		WindowEnd:          endHour,
		HoursCovered:       hoursCovered,
		KWhInWindow:        totalKWh,
		AvgKWhPerHour:      avgKWhPerHour,
		StdDevKWhPerHour:   stdDev,
		ProjectedKWhPerDay: projKWhPerDay,
		ProjectedKWhMonth:  projKWhMonth,
		ProjectedCostMonth: projCost,
		ProjectedCO2Kg:     projCO2,
		Currency:           currency,
		CostPerKWh:         costPerKWh,
		GridCarbonGCO2KWh:  gridGCO2,
		LowKWhMonth:        lowKWh,
		HighKWhMonth:       highKWh,
		LowCostMonth:       lowKWh * costPerKWh,
		HighCostMonth:      highKWh * costPerKWh,
		HasEnoughData:      hoursCovered >= 6,
	}
	return res, nil
}
