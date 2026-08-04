import { contextBridge, ipcRenderer } from 'electron'
import type { WattprintAPI, Settings, Snapshot } from '../shared/types.js'

const api: WattprintAPI = {
  start: () => ipcRenderer.invoke('wattprint:start'),

  getSettings: () => ipcRenderer.invoke('wattprint:getSettings'),
  updateSettings: (s: Settings) => ipcRenderer.invoke('wattprint:updateSettings', s),

  viewTotals: (fromIso, toIso, scope) =>
    ipcRenderer.invoke('wattprint:viewTotals', fromIso, toIso, scope),
  viewHourly: (fromIso, toIso, scope, key) =>
    ipcRenderer.invoke('wattprint:viewHourly', fromIso, toIso, scope, key),
  viewForecast: () => ipcRenderer.invoke('wattprint:viewForecast'),

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
