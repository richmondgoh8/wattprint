# Wattprint

> **See exactly how much electricity every app on your PC uses — in real time, in watts and cost.**

Real-time per-app and per-component power monitoring. Local-first, MIT licensed, open source.

![GitHub release](https://img.shields.io/github/v/release/richmondgoh8/wattprint)
![License](https://img.shields.io/github/license/richmondgoh8/wattprint)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue)

## Why

Most people don't know how much electricity their computer actually uses, or which apps are silently draining power. Wattprint makes it visible — broken down by app and by hardware component — and projects your monthly bill before you get it.

## What it does

- **Live dashboard** — 1-second updates of total wattage, per-component, and top apps.
- **Sleep Mode** — keep your music, kill the waste. One click (Live view or tray) throttles everything except your music apps (Task Manager's Efficiency Mode mechanism), and the "Sleep Mode · last session" card shows the kWh and dollars it saved vs your idle baseline.
- **Info** — compact CPU, GPU, RAM, disk, and network hardware details.
- **Top Consumers** — the current month's leaderboard (Aug 1 → today) of which apps cost you the most, with a projected kWh/mo column scaled from your running hours, a coverage bar (running vs. the month window), and an **Active-use** stat that separates real user activity from background running.
- **Calculator** — what any device costs to run: enter watts + hours/day + days/week and see kWh and cost per day / month / year (with presets for common devices).
- **Forecast** — projected monthly kWh and cost, with a 1σ confidence band, based on the trailing 30 days of hourly history, plus a "How you compare" panel benchmarking your PC against typical desktop/gaming PCs and households.
- **Measured vs estimated** — every number is labeled with its provenance (real sensor vs model), with an explainer for how each component is derived.
- **Per-app GPU watts** — measured GPU power is attributed to the apps driving it (WDDM engine share).
- **Tray widget** — live watts + cost in the tray tooltip, top apps in the tray menu, and a state-colored icon.
- **Where your energy goes** — the cost ledger is split into Active / Idle / Screen-off / Sleep / Off states.
- **Insights** — annualized cost, weekly trend, and "closing this app saves $X/yr" computed from your measured history.

Top Consumers and the Forecast benchmark show exactly how much history their numbers
are based on — e.g. "1.7 h of running across 10.4 d (August 1 – 11) · 1%" — so sparse or
on/off usage is always visible, never hidden. **Running** is wall-clock time the app was
open in the background (tray monitoring counts); **Active use** is the subset with real
user activity (idle, screen-off, and sleep don't count).

All data stays on your machine. No cloud, no telemetry, no tracking.

## Support & project

Wattprint is free and open source — if it saves you money, consider supporting it.

- [Buy me a coffee on Ko-fi](https://ko-fi.com/sinlucidious)
- [Star Wattprint on GitHub](https://github.com/richmondgoh8/wattprint)

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

Windows builds from Linux or WSL also require Wine with 32-bit support. Linux
builds do not require Wine. The release workflow builds Windows on a native
Windows runner and does not need Wine locally.

From WSL, `npm run build:win` downloads the Windows Electron native binary for
`better-sqlite3`, packages it, and restores the Linux binary for development.

## Third-party components

- `resources/lhm/` vendors the [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)
  v0.9.6 binary bundle (all files shipped in the official release `tools/` directory),
  loaded inside the persistent PowerShell helper to read real GPU power (AMD/NVIDIA)
  without any driver or installer. Licenses of the vendored assemblies:

  | Assembly | License |
  | --- | --- |
  | `LibreHardwareMonitorLib.dll`, `DiskInfoToolkit.dll`, `RAMSPDToolkit-NDD.dll`, `BlackSharp.Core.dll` | MIT (LibreHardwareMonitor) |
  | `HidSharp.dll` | Apache-2.0 |
  | `System.*.dll`, `Microsoft.Bcl.*.dll` | MIT (.NET runtime assemblies) |

  Apache-2.0 components retain their upstream attribution; see the
  [LibreHardwareMonitor NOTICE](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/master/NOTICE).

```sh
git clone https://github.com/richmondgoh8/wattprint
cd wattprint
npm install
npm run dev          # hot-reload dev mode
npm test             # unit tests (rebuilds the native module first)
npm run build:linux  # produces a Linux AppImage
npm run build:win    # produces Wattprint-0.1.0-portable.exe in dist/
```

## Development

- Node.js 20+ and npm 10+ (pinned via `engines` and `.nvmrc`).
- `npm run typecheck` — TypeScript for main/preload/renderer; `npm run check` — Svelte
  component checks.
- Unit tests live in `tests/` (vitest) and cover the store, rollups, forecasting,
  attribution, coverage math, and the machine-state ledger.
- On WSL, `npm run build:win` downloads the Windows Electron native binary for
  `better-sqlite3`, packages it via Wine, and restores the Linux binary afterwards —
  the restore is verified before the script exits. Native Windows runners don't need
  Wine (see the GitHub Actions release workflow).
- Every push/PR runs typecheck, svelte-check, unit tests, a renderer build, and a
  Windows packaging smoke build on CI.

## Architecture

```
src/
  main/              # Electron main process (Node)
    index.ts         # app lifecycle, BrowserWindow, tray
    ipc.ts           # ipcMain handlers
    config.ts        # electron-store
    store.ts         # better-sqlite3 + hourly rollups
    queries.ts       # worker query dispatch
    dbWorker.ts      # SQLite read queries off the main thread
    collector.ts     # per-second power sampler (host helper + models)
    hostProcesses.ts # persistent PowerShell process/GPU probe
    gpuPower.ts      # nvidia-smi / amd-smi CLI power probes
    hardware.ts      # hardware inventory + reference TDP lookup
    ledger.ts        # active/idle/screen-off/sleep state split
    sleepMode.ts     # EcoQoS throttling state machine
    eco.ts           # EcoQoS/IDLE priority application (Windows)
    tray.ts          # state-colored tray dot generation
    forecast.ts      # monthly projection
    insights.ts      # annualized insights
    benchmarks.ts    # comparison reference data
    service.ts       # sample + rollup loops, query worker
  preload/
    index.ts         # contextBridge — exposes window.api
  shared/
    types.ts         # shared TS types
  renderer/          # Svelte 5 + uPlot UI
    src/
      App.svelte
      views/         # Live, TopConsumers, Forecast, Info, Calculator, Settings
      lib/           # stores, format, sort, wails.ts, components/
```

## License

[MIT](./LICENSE)
