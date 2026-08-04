// Typed wrapper around the preload-exposed window.api.
// Same shape as the Wails-era wails.ts so the Svelte views need no changes.

import type {
  Snapshot,
  KeyTotal,
  HourlyRollup,
  ForecastResult,
  Settings,
  SystemInfo,
  WattprintAPI
} from '../../../shared/types.js'

declare global {
  interface Window {
    api: WattprintAPI
  }
}

// Re-export shared types so existing views can keep `import { Snapshot, Settings } from '../lib/wails'`
export type {
  Snapshot,
  KeyTotal,
  HourlyRollup,
  ForecastResult,
  Settings,
  SystemInfo
} from '../../../shared/types.js'

function api() {
  return window.api
}

export const start = (): Promise<void> => api().start()
export const getSettings = (): Promise<Settings> => api().getSettings()
export const updateSettings = (s: Settings): Promise<void> => api().updateSettings(s)
export const getSystemInfo = (): Promise<SystemInfo> => api().getSystemInfo()

export const viewTotals = (from: Date, to: Date, scope: string): Promise<KeyTotal[]> =>
  api().viewTotals(from.toISOString(), to.toISOString(), scope)

export const viewHourly = (from: Date, to: Date, scope: string, key: string): Promise<HourlyRollup[]> =>
  api().viewHourly(from.toISOString(), to.toISOString(), scope, key)

export const viewForecast = (): Promise<ForecastResult> => api().viewForecast()

export const onSample = (cb: (s: Snapshot) => void): (() => void) => api().onSample(cb)
export const onStatus = (cb: (s: string) => void): (() => void) => api().onStatus(cb)
