// Settings persistence via electron-store.
// Per-user directory: app.getPath('userData')/wattprint/
// Same shape as internal/config/config.go in the Wails version.

import Store from 'electron-store'
import type { Settings } from '../shared/types.js'

const DEFAULTS: Settings = {
  costPerKWh: 0.17,
  currency: 'USD',
  gridCarbonIntensity: 384,
  forecastWindowDays: 7,
  sampleIntervalSeconds: 1,
  startOnLogin: false,
  theme: 'system'
}

let store: Store<Settings> | null = null

export function initConfig(): void {
  store = new Store<Settings>({
    name: 'settings',
    defaults: DEFAULTS,
    // validation
    schema: {
      costPerKWh: { type: 'number', minimum: 0 },
      currency: { type: 'string', minLength: 1, maxLength: 8 },
      gridCarbonIntensity: { type: 'number', minimum: 0 },
      forecastWindowDays: { type: 'integer', minimum: 1, maximum: 365 },
      sampleIntervalSeconds: { type: 'integer', minimum: 1, maximum: 60 },
      startOnLogin: { type: 'boolean' },
      theme: { type: 'string', enum: ['system', 'light', 'dark'] }
    }
  })
}

export function getSettings(): Settings {
  if (!store) throw new Error('config not initialized')
  return { ...DEFAULTS, ...store.store }
}

export function updateSettings(patch: Partial<Settings>): Settings {
  if (!store) throw new Error('config not initialized')
  // Apply only fields present in patch; zero values are skipped so the
  // frontend can PATCH-style update without resetting unspecified fields.
  const cur = store.store
  const next: Settings = { ...cur }
  if (typeof patch.costPerKWh === 'number' && patch.costPerKWh > 0) next.costPerKWh = patch.costPerKWh
  if (typeof patch.currency === 'string' && patch.currency) next.currency = patch.currency
  if (typeof patch.gridCarbonIntensity === 'number' && patch.gridCarbonIntensity > 0)
    next.gridCarbonIntensity = patch.gridCarbonIntensity
  if (typeof patch.forecastWindowDays === 'number' && patch.forecastWindowDays > 0)
    next.forecastWindowDays = patch.forecastWindowDays
  if (typeof patch.sampleIntervalSeconds === 'number' && patch.sampleIntervalSeconds > 0)
    next.sampleIntervalSeconds = patch.sampleIntervalSeconds
  if (typeof patch.theme === 'string' && patch.theme) next.theme = patch.theme
  if (typeof patch.startOnLogin === 'boolean') next.startOnLogin = patch.startOnLogin
  store.store = next
  return next
}

export function configDir(): string {
  if (!store) throw new Error('config not initialized')
  return store.path
}
