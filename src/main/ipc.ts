// IPC handlers — bind the service to the renderer via contextBridge.

import { ipcMain, type BrowserWindow } from 'electron'
import { getSettings, updateSettings } from './config.js'
import { totalsByKey, hourlyByKey } from './store.js'
import type { Service } from './service.js'
import type { Settings, KeyTotal, HourlyRollup } from '../shared/types.js'
import type { ForecastResult } from './forecast.js'

export function registerIpcHandlers(svc: Service): void {
  ipcMain.handle('wattprint:start', () => {
    svc.start()
  })

  ipcMain.handle('wattprint:getSettings', (): Settings => getSettings())
  ipcMain.handle('wattprint:updateSettings', (_e, patch: Partial<Settings>): Settings => {
    return updateSettings(patch)
  })

  ipcMain.handle(
    'wattprint:viewTotals',
    (_e, fromIso: string, toIso: string, scope: string): KeyTotal[] => {
      return totalsByKey(new Date(fromIso), new Date(toIso), scope)
    }
  )

  ipcMain.handle(
    'wattprint:viewHourly',
    (_e, fromIso: string, toIso: string, scope: string, key: string): HourlyRollup[] => {
      return hourlyByKey(new Date(fromIso), new Date(toIso), scope, key)
    }
  )

  ipcMain.handle('wattprint:viewForecast', (): ForecastResult => svc.viewForecast())
}
