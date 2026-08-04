# Wattprint

> **See exactly how much electricity every app on your PC uses — in real time, in watts, dollars, and carbon.**

Real-time per-app and per-component power monitoring. Local-first, MIT licensed, open source.

![GitHub release](https://img.shields.io/github/v/release/richmondgoh8/wattprint)
![License](https://img.shields.io/github/license/richmondgoh8/wattprint)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-blue)

## Why

Most people don't know how much electricity their computer actually uses, or which apps are silently draining power. Wattprint makes it visible — broken down by app and by hardware component — and projects your monthly bill before you get it.

## What it does

- **Live dashboard** — 1-second updates of total wattage, per-component, and top apps.
- **Per-hour average** — distinct from real-time. See your average over 1h / 6h / 24h / 7d / 30d.
- **All Devices** — CPU / GPU / RAM / disk / network broken down by kWh, share, and peak draw.
- **Top Consumers** — leaderboard of which apps cost you the most, over any window.
- **Forecast** — projected monthly kWh and cost, with a 1σ confidence band, based on a trailing 7- or 30-day window.

All data stays on your machine. No cloud, no telemetry, no tracking.

## Stack

- [Electron](https://electronjs.org) — cross-platform desktop runtime
- [electron-vite](https://electron-vite.org) — single-config build for main + preload + renderer
- [Svelte 5](https://svelte.dev) + TypeScript + Vite
- [uPlot](https://github.com/leeoniya/uPlot) — live charts
- [systeminformation](https://github.com/sebhildebrandt/systeminformation) — system metrics
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — embedded SQLite
- [electron-store](https://github.com/sindresorhus/electron-store) — user settings

## Quick start

### Requirements
- Node.js 20+
- npm 10+
- Build tools for native modules (gcc, python3, make)

```sh
git clone https://github.com/richmondgoh8/wattprint
cd wattprint
npm install
npm run dev          # hot-reload dev mode
npm run build:win    # produces Wattprint-0.1.0-portable.exe in dist/
```

## Architecture

```
src/
  main/              # Electron main process (Node)
    index.ts         # app lifecycle, BrowserWindow
    ipc.ts           # ipcMain handlers
    config.ts        # electron-store
    store.ts         # better-sqlite3
    collector.ts     # systeminformation sampling
    forecast.ts      # monthly projection
    service.ts       # sample + rollup loops
  preload/
    index.ts         # contextBridge — exposes window.api
  shared/
    types.ts         # shared TS types
  renderer/          # Svelte 5 + uPlot UI
    src/
      App.svelte
      views/         # Live, Hourly, AllDevices, TopConsumers, Forecast, Settings
      lib/           # stores, format, ipc (wails.ts)
```

## License

[MIT](./LICENSE)
