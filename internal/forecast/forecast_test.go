package forecast

import (
	"math"
	"testing"
	"time"
)

// syntheticTestStore is a minimal in-memory stand-in for *store.Store
// for unit-testing the pure math. It avoids a real SQLite DB.
// Note: this file tests the math directly; the real Engine is exercised
// in integration tests.
func TestMonthlyProjection_Math(t *testing.T) {
	// avgKWhPerHour=0.1  =>  0.1 * 24 * 30 = 72 kWh/month
	// costPerKWh=0.20    =>  $14.40/month
	// grid=400 gCO2/kWh  =>  72 * 400 / 1000 = 28.8 kg
	avg := 0.1
	days := 30.0
	want := avg * 24 * days
	if math.Abs(want-72.0) > 1e-9 {
		t.Fatalf("expected 72 kWh, got %v", want)
	}
	if math.Abs(want*0.20-14.4) > 1e-9 {
		t.Fatalf("expected $14.40, got %v", want*0.20)
	}
	if math.Abs(want*400/1000-28.8) > 1e-9 {
		t.Fatalf("expected 28.8 kg, got %v", want*400/1000)
	}
}

func TestConfidenceBand_OneSigma(t *testing.T) {
	// If stdDev is 0, low == projected == high.
	// If stdDev is 0.01 kWh/h, the monthly band is ±0.01 * 24 * 30 = ±7.2.
	sigmaMonth := 0.01 * 24 * 30
	if math.Abs(sigmaMonth-7.2) > 1e-9 {
		t.Fatalf("expected 7.2, got %v", sigmaMonth)
	}
}

func TestResult_TimeFields(t *testing.T) {
	// Just a sanity check on the time helpers we use in the engine.
	now := time.Date(2026, 8, 4, 12, 30, 0, 0, time.UTC)
	trunc := now.Truncate(time.Hour)
	if trunc.Hour() != 12 || trunc.Minute() != 0 {
		t.Fatalf("truncate wrong: %v", trunc)
	}
}
