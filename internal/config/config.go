// Package config loads and persists user settings under the
// OS-appropriate per-user config directory. Cross-platform via
// os.UserConfigDir(): %APPDATA%\wattprint on Windows,
// ~/Library/Application Support/wattprint on macOS,
// ~/.config/wattprint on Linux.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
)

// Settings is the full set of user-tunable values.
type Settings struct {
	// Cost per kWh in the user's currency (e.g. 0.17 USD/kWh).
	CostPerKWh float64 `json:"costPerKWh"`
	// ISO 4217 currency code (e.g. "USD", "EUR", "MYR").
	Currency string `json:"currency"`
	// Grid carbon intensity in gCO2 per kWh. Region-specific.
	// Defaults: USA 384, EU ~230, MY 631, FR 42, CN 555.
	GridCarbonIntensity float64 `json:"gridCarbonIntensity"`
	// Forecast window in days. 7 or 30 are sensible choices.
	ForecastWindowDays int `json:"forecastWindowDays"`
	// Sampling interval in seconds. 1s is the default; raise if CPU bound.
	SampleIntervalSeconds int `json:"sampleIntervalSeconds"`
	// Whether to start Wattprint on login (planned, not yet wired).
	StartOnLogin bool `json:"startOnLogin"`
	// UI theme: "system" | "light" | "dark".
	Theme string `json:"theme"`
}

// Default returns the factory defaults.
func Default() Settings {
	return Settings{
		CostPerKWh:            0.17,
		Currency:              "USD",
		GridCarbonIntensity:   384,
		ForecastWindowDays:    7,
		SampleIntervalSeconds: 1,
		StartOnLogin:          false,
		Theme:                 "system",
	}
}

// Store persists Settings to disk.
type Store struct {
	path string
	mu   sync.RWMutex
	cur  Settings
}

// New returns a Store rooted at the per-user config directory.
// Creates the directory if missing.
func New(appName string) (*Store, error) {
	if appName == "" {
		appName = "wattprint"
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return nil, fmt.Errorf("user config dir: %w", err)
	}
	dir := filepath.Join(base, appName)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create config dir: %w", err)
	}
	s := &Store{
		path: filepath.Join(dir, "settings.json"),
		cur:  Default(),
	}
	if err := s.load(); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	return s, nil
}

// Path returns the directory in which the store keeps its files.
// Useful for the SQLite store so it can colocate wattprint.db.
func (s *Store) Path() string { return filepath.Dir(s.path) }

// Get returns a copy of the current settings.
func (s *Store) Get() Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cur
}

// Update applies fn to the current settings and persists the result.
// Validates and returns an error if the resulting settings are invalid.
func (s *Store) Update(fn func(*Settings)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(&s.cur)
	if err := validate(&s.cur); err != nil {
		return err
	}
	return s.saveLocked()
}

func (s *Store) load() error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	var out Settings
	if err := json.Unmarshal(data, &out); err != nil {
		return fmt.Errorf("parse settings: %w", err)
	}
	// Apply defaults to any zero-valued fields so older configs upgrade cleanly.
	if out.Currency == "" {
		out.Currency = Default().Currency
	}
	if out.Theme == "" {
		out.Theme = Default().Theme
	}
	if out.SampleIntervalSeconds <= 0 {
		out.SampleIntervalSeconds = Default().SampleIntervalSeconds
	}
	if out.ForecastWindowDays <= 0 {
		out.ForecastWindowDays = Default().ForecastWindowDays
	}
	s.cur = out
	return nil
}

func (s *Store) saveLocked() error {
	data, err := json.MarshalIndent(s.cur, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func validate(s *Settings) error {
	switch {
	case s.CostPerKWh < 0:
		return errors.New("costPerKWh must be >= 0")
	case s.GridCarbonIntensity < 0:
		return errors.New("gridCarbonIntensity must be >= 0")
	case s.ForecastWindowDays < 1 || s.ForecastWindowDays > 365:
		return errors.New("forecastWindowDays must be in [1, 365]")
	case s.SampleIntervalSeconds < 1 || s.SampleIntervalSeconds > 60:
		return errors.New("sampleIntervalSeconds must be in [1, 60]")
	}
	return nil
}
