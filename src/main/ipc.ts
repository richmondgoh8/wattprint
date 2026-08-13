// IPC handlers — bind the service to the renderer via contextBridge.

import { app, ipcMain, type BrowserWindow } from 'electron'
import { getSettings, updateSettings } from './config.js'
import { resetStatistics } from './store.js'
import type { Service } from './service.js'
import type { Readiness, Settings, KeyTotal, SystemInfo, MachineStateRow, Insights, SleepSession, Benchmark, TrackingInfo } from '../shared/types.js'
import type { ForecastResult } from './forecast.js'

function safeDate(iso: string): Date {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${iso}`)
  return d
}

function applyLoginItem(startOnLogin: boolean): void {
  if (process.platform === 'linux') return
  try {
    app.setLoginItemSettings({ openAtLogin: startOnLogin })
  } catch {
    // best-effort: login items may be unavailable on some setups
  }
}

export function registerIpcHandlers(svc: Service): void {
  ipcMain.handle('wattprint:start', () => {
    svc.start()
    applyLoginItem(getSettings().startOnLogin)
  })
  ipcMain.handle('wattprint:resetStatistics', () => {
    resetStatistics()
  })

  ipcMain.handle('wattprint:getSettings', (): Settings => getSettings())
  ipcMain.handle('wattprint:updateSettings', (_e, patch: Partial<Settings>): Settings => {
    const saved = updateSettings(patch)
    if (typeof patch.startOnLogin === 'boolean') applyLoginItem(saved.startOnLogin)
    svc.reloadSettings()
    return saved
  })
  ipcMain.handle('wattprint:getSystemInfo', (): Promise<SystemInfo> => svc.viewSystemInfo())
  ipcMain.handle('wattprint:getReadiness', (): Promise<Readiness> => svc.getReadiness())

  ipcMain.handle(
    'wattprint:viewTotals',
    (_e, fromIso: string, toIso: string, scope: string): Promise<KeyTotal[]> => {
      return svc.viewTotals(safeDate(fromIso), safeDate(toIso), scope)
    }
  )

  ipcMain.handle('wattprint:viewForecast', (): Promise<ForecastResult> => svc.viewForecast())

  ipcMain.handle(
    'wattprint:viewMachineStates',
    (_e, fromIso: string, toIso: string): Promise<MachineStateRow[]> =>
      svc.viewMachineStates(safeDate(fromIso), safeDate(toIso))
  )

  ipcMain.handle('wattprint:getInsights', (): Promise<Insights> => svc.viewInsights())

  ipcMain.handle(
    'wattprint:getTrackingInfo',
    (_e, fromIso?: string | null): Promise<TrackingInfo> => svc.viewTrackingInfo(fromIso)
  )

  ipcMain.handle('wattprint:getBenchmark', (): Promise<Benchmark> => svc.viewBenchmark())

  ipcMain.handle(
    'wattprint:getSleepSessions',
    (_e, fromIso: string, toIso: string): Promise<SleepSession[]> => svc.viewSleepSessions(safeDate(fromIso), safeDate(toIso))
  )

  ipcMain.handle('wattprint:setSleepMode', (_e, on: boolean): Promise<void> => svc.setSleepMode(on))
}
