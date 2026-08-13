// Electron main process — lifecycle + wires up config, store, service, IPC.

import { app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { getSettings, initConfig, getWindowState, setWindowState } from './config.js'
import { initStore, closeStore } from './store.js'
import { registerIpcHandlers } from './ipc.js'
import { Service } from './service.js'
import { stateColorKey, stateDot } from './tray.js'
import type { Snapshot } from '../shared/types.js'

let mainWindow: BrowserWindow | null = null
let service: Service | null = null
let tray: Tray | null = null
let isQuitting = false
let trayBalloonShown = false
let lastTrayMenuAt = 0
let lastTrayPaintAt = 0
let lastTrayColorKey: string | null = null

function trayIconPath(): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  return join(base, 'tray.ico')
}

function showMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function showTrayBalloon(): void {
  if (trayBalloonShown || !tray || process.platform !== 'win32') return
  trayBalloonShown = true
  tray.displayBalloon({
    title: 'Wattprint',
    content: 'Wattprint is still running in the system tray.'
  })
}

function fmtWatts(watts: number): string {
  return watts >= 1000 ? `${(watts / 1000).toFixed(2)} kW` : `${watts.toFixed(1)} W`
}

function emptySnapshot(): Snapshot {
  return {
    totalW: 0,
    processes: [],
    gpuConsumers: [],
    processCount: 0,
    gpuUtilPct: null,
    gpuTopProcess: null,
    cpuLoadPct: null,
    memoryUsedBytes: 0,
    memoryTotalBytes: 0,
    components: {},
    componentSources: {},
    cpuTdpW: null,
    cpuTdpResolved: false,
    sleepMode: { active: false, supported: false, since: null, baselineW: 0, throttledCount: 0 },
    ts: new Date().toISOString()
  }
}

/** Live tray widget: state dot, watts + cost in the tooltip, top apps in the menu.
 *  The image/tooltip are repainted at most every 2s (or immediately on a state
 *  color change) so the per-second sampling loop doesn't churn the OS. */
function updateTray(s: Snapshot): void {
  if (!tray) return
  const now = Date.now()
  const colorKey = stateColorKey(s.totalW)
  if (colorKey !== lastTrayColorKey || now - lastTrayPaintAt >= 2000) {
    lastTrayPaintAt = now
    lastTrayColorKey = colorKey
    const cost = getSettings()
    const perHour = (s.totalW / 1000) * cost.costPerKWh
    const costText = `${perHour.toFixed(3)} ${cost.currency}/h`
    const top = s.processes
      .filter((p) => p.w > 0 && p.pid !== 0)
      .slice(0, 3)
      .map((p) => `${p.name} ${fmtWatts(p.w)}`)
      .join(' · ')
    tray.setToolTip(`Wattprint — ${fmtWatts(s.totalW)} · ${costText}${top ? `\n${top}` : ''}`)
    const dot = stateDot(s.totalW)
    if (!dot.isEmpty()) tray.setImage(dot)
  }
  if (now - lastTrayMenuAt > 5000) {
    lastTrayMenuAt = now
    tray.setContextMenu(buildTrayMenu(s))
  }
}

function buildTrayMenu(s: Snapshot): Menu {
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: `${fmtWatts(s.totalW)} now`, enabled: false },
    { label: `cost ${((s.totalW / 1000) * getSettings().costPerKWh).toFixed(3)} ${getSettings().currency}/h`, enabled: false },
    { type: 'separator' }
  ]
  const top = s.processes.filter((p) => p.w > 0 && p.pid !== 0).slice(0, 5)
  if (top.length > 0) {
    items.push({ label: 'Top apps', submenu: top.map((p) => ({ label: `${p.name} — ${fmtWatts(p.w)}`, enabled: false })) })
    items.push({ type: 'separator' })
  }
  if (s.sleepMode?.supported) {
    items.push({
      label: s.sleepMode.active ? 'Exit Sleep Mode' : 'Enter Sleep Mode',
      click: () => {
        service?.setSleepMode(!s.sleepMode?.active).catch(() => {
          // best-effort
        })
      }
    })
    items.push({ type: 'separator' })
  }
  items.push({ label: 'Open Wattprint', click: () => showMainWindow() })
  items.push({ type: 'separator' })
  items.push({
    label: 'Quit',
    click: () => {
      isQuitting = true
      app.quit()
    }
  })
  return Menu.buildFromTemplate(items)
}

function createTray(): void {
  let icon = nativeImage.createFromPath(trayIconPath())
  if (icon.isEmpty()) icon = nativeImage.createFromPath(process.execPath)
  tray = new Tray(icon)
  tray.setToolTip('Wattprint')
  tray.setContextMenu(buildTrayMenu(emptySnapshot()))
  tray.on('double-click', () => showMainWindow())
}

function createWindow(): void {
  const state = getWindowState()
  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width ?? 1280,
    height: state.height ?? 800,
    minWidth: 960,
    minHeight: 600,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#0d1117',
    title: 'Wattprint',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (state.maximized) mainWindow.maximize()

  let stateTimer: NodeJS.Timeout | null = null
  const persistState = (): void => {
    if (!mainWindow) return
    if (stateTimer) clearTimeout(stateTimer)
    stateTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const bounds = mainWindow.getBounds()
      setWindowState({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        maximized: mainWindow.isMaximized()
      })
    }, 400)
  }
  mainWindow.on('resized', persistState)
  mainWindow.on('moved', persistState)

  mainWindow.on('close', (event) => {
    if (!isQuitting && getSettings().closeToTray) {
      event.preventDefault()
      mainWindow?.hide()
      showTrayBalloon()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Open http(s) links in the system browser; deny everything else so the
  // renderer can never reach arbitrary schemes (file:, custom protocols).
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//i.test(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

// Single-instance: a second launch focuses the existing window.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('dev.richmondgoh8.wattprint')

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Init config + store before anything tries to use them
    const t0 = Date.now()
    const userData = app.getPath('userData')
    const wattprintDir = join(userData, 'wattprint')
    initConfig()
    initStore(wattprintDir)
    console.log('[wattprint] startup: store ready in', Date.now() - t0, 'ms')

    // Service emits sample/status to the main window and feeds the tray widget
    service = new Service(() => mainWindow, (s) => updateTray(s), wattprintDir)
    registerIpcHandlers(service)
    service.start()
    console.log('[wattprint] startup: service started in', Date.now() - t0, 'ms')

    createWindow()
    createTray()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    console.error('Wattprint failed to start:', message)
    dialog.showErrorBox('Wattprint failed to start', message)
    app.quit()
  })
}

app.on('window-all-closed', () => {
  // Honor "close to tray": when disabled, closing the last window quits.
  // On macOS the app stays alive per platform convention.
  if (process.platform !== 'darwin' && !getSettings().closeToTray) {
    app.quit()
  }
})

let quitDrained = false
app.on('before-quit', (event) => {
  isQuitting = true
  if (quitDrained) return
  quitDrained = true
  // Defer the actual quit until sampling is stopped, any Sleep Mode
  // throttling is reverted, and the DB is closed — bounded so shutdown
  // can never hang (revert is capped at 3s, this is the final cap).
  event.preventDefault()
  const drain = (async () => {
    try {
      await service?.stop()
    } catch {
      // best-effort
    }
  })()
  void Promise.race([drain, sleep(3000)]).then(() => {
    try {
      closeStore()
    } catch {
      // best-effort
    }
    app.exit(0)
  })
})

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
