// Settings persistence via electron-store.
// Per-user directory: app.getPath('userData')/wattprint/
// Same shape as internal/config/config.go in the Wails version.

import Store from 'electron-store'
import type { Settings } from '../shared/types.js'

const DEFAULTS: Settings = {
  costPerKWh: 0.17,
  currency: 'USD',
  sampleIntervalSeconds: 1,
  startOnLogin: false,
  closeToTray: true,
  theme: 'system',
  sleepMode: { whitelist: ['spotify', 'spotify web helper', 'chrome'] }
}

let store: Store<Settings> | null = null
let windowStore: Store<WindowState> | null = null
type LegacySettings = Settings & { gridCarbonIntensity?: number }

export interface WindowState {
  x?: number
  y?: number
  width?: number
  height?: number
  maximized: boolean
}

export function initConfig(): void {
  store = new Store<Settings>({
    name: 'settings',
    defaults: DEFAULTS,
    // validation
    schema: {
      costPerKWh: { type: 'number', minimum: 0 },
      currency: { type: 'string', minLength: 1, maxLength: 8 },
      sampleIntervalSeconds: { type: 'integer', minimum: 1, maximum: 60 },
      startOnLogin: { type: 'boolean' },
      closeToTray: { type: 'boolean' },
      theme: { type: 'string', enum: ['system', 'light', 'dark'] },
      sleepMode: {
        type: 'object',
        properties: {
          whitelist: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  })
  windowStore = new Store<WindowState>({
    name: 'window',
    defaults: { maximized: false }
  })
  const saved = store.store as LegacySettings
  if ('gridCarbonIntensity' in saved) {
    const { gridCarbonIntensity: _unused, ...clean } = saved
    store.store = clean
  }
}

export function getSettings(): Settings {
  if (!store) throw new Error('config not initialized')
  const { gridCarbonIntensity: _unused, ...saved } = store.store as LegacySettings
  return { ...DEFAULTS, ...saved }
}

export function updateSettings(patch: Partial<Settings>): Settings {
  if (!store) throw new Error('config not initialized')
  // Apply only fields present in patch; zero values are skipped so the
  // frontend can PATCH-style update without resetting unspecified fields.
  const { gridCarbonIntensity: _unused, ...cur } = store.store as LegacySettings
  const next: Settings = { ...cur }
  if (typeof patch.costPerKWh === 'number' && patch.costPerKWh >= 0) next.costPerKWh = patch.costPerKWh
  if (typeof patch.currency === 'string' && patch.currency) next.currency = patch.currency
  if (typeof patch.sampleIntervalSeconds === 'number' && patch.sampleIntervalSeconds > 0)
    next.sampleIntervalSeconds = patch.sampleIntervalSeconds
  if (typeof patch.theme === 'string' && patch.theme) next.theme = patch.theme
  if (typeof patch.startOnLogin === 'boolean') next.startOnLogin = patch.startOnLogin
  if (typeof patch.closeToTray === 'boolean') next.closeToTray = patch.closeToTray
  if (patch.sleepMode && typeof patch.sleepMode === 'object') {
    const whitelist = Array.isArray(patch.sleepMode.whitelist)
      ? patch.sleepMode.whitelist.map((w) => String(w).toLowerCase()).filter((w) => w.length > 0)
      : next.sleepMode.whitelist
    next.sleepMode = { whitelist }
  }
  store.store = next
  return next
}

export function getWindowState(): WindowState {
  if (!windowStore) throw new Error('config not initialized')
  return windowStore.store
}

export function setWindowState(partial: Partial<WindowState>): void {
  if (!windowStore) throw new Error('config not initialized')
  windowStore.store = { ...windowStore.store, ...partial }
}
