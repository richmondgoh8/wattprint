import { contextBridge, ipcRenderer } from 'electron'
import type { WattprintAPI, Settings, Snapshot, SystemInfo, MachineStateRow, Insights, SleepSession, Benchmark, TrackingInfo } from '../shared/types.js'

const api: WattprintAPI = {
  start: () => ipcRenderer.invoke('wattprint:start'),
  resetStatistics: () => ipcRenderer.invoke('wattprint:resetStatistics'),

  getSettings: () => ipcRenderer.invoke('wattprint:getSettings'),
  updateSettings: (s: Partial<Settings>) => ipcRenderer.invoke('wattprint:updateSettings', { ...s }),
  getSystemInfo: (): Promise<SystemInfo> => ipcRenderer.invoke('wattprint:getSystemInfo'),
  getReadiness: () => ipcRenderer.invoke('wattprint:getReadiness'),

  viewTotals: (fromIso, toIso, scope) =>
    ipcRenderer.invoke('wattprint:viewTotals', fromIso, toIso, scope),
  viewForecast: () => ipcRenderer.invoke('wattprint:viewForecast'),
  viewMachineStates: (fromIso, toIso) =>
    ipcRenderer.invoke('wattprint:viewMachineStates', fromIso, toIso),
  getInsights: (): Promise<Insights> => ipcRenderer.invoke('wattprint:getInsights'),
  getTrackingInfo: (fromIso?: string | null): Promise<TrackingInfo> =>
    ipcRenderer.invoke('wattprint:getTrackingInfo', fromIso),
  getBenchmark: (): Promise<Benchmark> => ipcRenderer.invoke('wattprint:getBenchmark'),
  getSleepSessions: (fromIso, toIso): Promise<SleepSession[]> =>
    ipcRenderer.invoke('wattprint:getSleepSessions', fromIso, toIso),
  setSleepMode: (on: boolean): Promise<void> => ipcRenderer.invoke('wattprint:setSleepMode', on),

  onSample: (cb: (s: Snapshot) => void) => {
    const listener = (_e: unknown, s: Snapshot): void => cb(s)
    ipcRenderer.on('wattprint:sample', listener)
    return () => {
      ipcRenderer.removeListener('wattprint:sample', listener)
    }
  },
  onStatus: (cb: (s: string) => void) => {
    const listener = (_e: unknown, s: string): void => cb(s)
    ipcRenderer.on('wattprint:status', listener)
    return () => {
      ipcRenderer.removeListener('wattprint:status', listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
