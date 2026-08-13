// Typed wrapper around the preload-exposed window.api.
// Same shape as the Wails-era wails.ts so the Svelte views need no changes.

import type {
  Snapshot,
  KeyTotal,
  ForecastResult,
  Settings,
  SystemInfo,
  Readiness,
  MachineStateRow,
  Insights,
  SourceKind,
  SleepSession,
  Benchmark,
  TrackingInfo,
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
  ForecastResult,
  Settings,
  SystemInfo,
  Readiness,
  MachineStateRow,
  Insights,
  SourceKind,
  SleepSession,
  Benchmark,
  TrackingInfo
} from '../../../shared/types.js'

function api() {
  return window.api
}

export const start = (): Promise<void> => api().start()
export const resetStatistics = (): Promise<void> => api().resetStatistics()
export const getSettings = (): Promise<Settings> => api().getSettings()

/** Deep-copy to plain JSON-safe objects. Svelte 5 $state values are Proxies,
 *  which Electron's structured clone cannot serialize (DataCloneError). */
export function deepPlain<T>(value: T): T {
  return value == null ? value : (JSON.parse(JSON.stringify(value)) as T)
}

export const updateSettings = (s: Partial<Settings>): Promise<Settings> => api().updateSettings(deepPlain(s))
export const getSystemInfo = (): Promise<SystemInfo> => api().getSystemInfo()
export const getReadiness = (): Promise<Readiness> => api().getReadiness()

export const viewTotals = (from: Date, to: Date, scope: string): Promise<KeyTotal[]> =>
  api().viewTotals(from.toISOString(), to.toISOString(), scope)

export const viewForecast = (): Promise<ForecastResult> => api().viewForecast()

export const viewMachineStates = (from: Date, to: Date): Promise<MachineStateRow[]> =>
  api().viewMachineStates(from.toISOString(), to.toISOString())

export const getInsights = (): Promise<Insights> => api().getInsights()

export const getTrackingInfo = (fromIso?: string | null): Promise<TrackingInfo> => api().getTrackingInfo(fromIso)

export const getBenchmark = (): Promise<Benchmark> => api().getBenchmark()

export const getSleepSessions = (from: Date, to: Date): Promise<SleepSession[]> =>
  api().getSleepSessions(from.toISOString(), to.toISOString())

export const setSleepMode = (on: boolean): Promise<void> => api().setSleepMode(on)

export const onSample = (cb: (s: Snapshot) => void): (() => void) => api().onSample(cb)
export const onStatus = (cb: (s: string) => void): (() => void) => api().onStatus(cb)
