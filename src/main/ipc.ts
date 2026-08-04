// Session 1 placeholder. Real handlers land in Session 2.
// Stubs return sensible defaults so renderer can mount without errors.

import { ipcMain } from 'electron'
import type {
  KeyTotal,
  HourlyRollup,
  ForecastResult,
  Settings
} from '../shared/types.js'

export function registerIpcHandlers(): void {
  ipcMain.handle('wattprint:start', async (): Promise<void> => {
    // Wired in Session 2.
  })

  ipcMain.handle('wattprint:getSettings', async (): Promise<Settings> => {
    return {
      costPerKWh: 0.17,
      currency: 'USD',
      gridCarbonIntensity: 384,
      forecastWindowDays: 7,
      sampleIntervalSeconds: 1,
      startOnLogin: false,
      theme: 'system'
    }
  })

  ipcMain.handle(
    'wattprint:updateSettings',
    async (_e, _s: Settings): Promise<void> => {
      // Wired in Session 2.
    }
  )

  ipcMain.handle(
    'wattprint:viewTotals',
    async (_e, _fromIso: string, _toIso: string, _scope: string): Promise<KeyTotal[]> => []
  )

  ipcMain.handle(
    'wattprint:viewHourly',
    async (
      _e,
      _fromIso: string,
      _toIso: string,
      _scope: string,
      _key: string
    ): Promise<HourlyRollup[]> => []
  )

  ipcMain.handle('wattprint:viewForecast', async (): Promise<ForecastResult> => ({
    windowDays: 7,
    windowStart: new Date().toISOString(),
    windowEnd: new Date().toISOString(),
    hoursCovered: 0,
    kWhInWindow: 0,
    avgKWhPerHour: 0,
    stdDevKWhPerHour: 0,
    projectedKWhPerDay: 0,
    projectedKWhMonth: 0,
    projectedCostMonth: 0,
    projectedCO2Kg: 0,
    currency: 'USD',
    costPerKWh: 0.17,
    gridCarbonGCO2PerKWh: 384,
    lowKWhMonth: 0,
    highKWhMonth: 0,
    lowCostMonth: 0,
    highCostMonth: 0,
    hasEnoughData: false
  }))
}
