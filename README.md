# Wattprint

> **See exactly how much electricity every app on your PC uses — in real time, in watts, dollars, and carbon.**

Real-time per-app and per-component power monitoring for Windows. Local-first, MIT licensed, open source.

![GitHub release](https://img.shields.io/github/v/release/richmondgoh8/wattprint)
![License](https://img.shields.io/github/license/richmondgoh8/wattprint)
![Platform](https://img.shields.io/badge/platform-Windows-0078d4)

## Why

Most people don't know how much electricity their PC actually uses, or which apps are silently draining power. Wattprint makes it visible — broken down by app and by hardware component — and projects your monthly bill before you get it.

## What it does

- **Live dashboard** — 1-second updates of total wattage, per-component, and top apps.
- **Per-hour average** — distinct from real-time. See your average over 1h / 6h / 24h / 7d / 30d.
- **All Devices** — CPU / GPU / RAM / disk / network broken down by kWh, share, and peak draw.
- **Top Consumers** — leaderboard of which apps cost you the most, over any window.
- **Forecast** — projected monthly kWh and cost, with a 1σ confidence band, based on a trailing 7- or 30-day window.

All data stays on your machine. No cloud, no telemetry, no tracking.

## Stack

- [Wails v2](https://wails.io) — Go backend, native webview frontend
- [Svelte 5](https://svelte.dev) + TypeScript + Vite
- [uPlot](https://github.com/leeoniya/uPlot) — live charts
- [gopsutil](https://github.com/shirou/gopsutil) — system metrics
- [modernc.org/sqlite](https://pkg.go.dev/modernc.org/sqlite) — pure-Go SQLite (no CGO, no DLL hell)

## Quick start

### Requirements
- Go 1.23+
- Node.js 20+
- Wails CLI v2.13+

```sh
go install github.com/wailsapp/wails/v2/cmd/wails@latest
git clone https://github.com/richmondgoh8/wattprint
cd wattprint
wails dev          # hot-reload dev mode
wails build        # produces wattprint.exe in build/bin/
```

The single `.exe` is portable — no installer required.

## Architecture

```
cmd/wattprint/        # entry point
internal/
  app/                # Wails binding layer (thin)
  service/            # domain logic: sampling loop, rollup loop, queries
  collector/          # per-component power estimation + per-process attribution
  store/              # SQLite repository (WAL mode)
  forecast/           # monthly projection engine
  config/             # user settings persistence
frontend/             # Svelte 5 + uPlot UI
```

The collector estimates wattage from CPU/GPU utilization, memory usage, and I/O activity. Per-process attribution distributes total CPU watts across processes by their CPU% share. GPU per-process attribution is a v0.2 enhancement (NVML).

All readings persist to a local SQLite database; the hourly rollup loop maintains pre-aggregated buckets so the views stay fast even with months of history.

## Roadmap

- **v0.1** (current) — Windows MVP: live, hourly average, all devices, top consumers, forecast
- **v0.2** — Time-of-day weighted forecast, hour-of-day heatmap, export CSV/JSON, i18n (FR/DE/ES/ZH)
- **v0.3** — Budgets & alerts, Linux build (RAPL), on-screen overlay
- **v1.0** — Smart-plug calibration wizard, auto-update, code signing, plugin API

## License

[MIT](./LICENSE)

## Inspired by

[WattSeal](https://github.com/Daminoup88/WattSeal) — the real-time PC power monitor by Damien Philippe & Paul Mallard. Wattprint's per-app attribution and local-first philosophy follow the same path; the differentiated features (per-hour averages, monthly forecast, confidence bands) are what we think make the difference.
