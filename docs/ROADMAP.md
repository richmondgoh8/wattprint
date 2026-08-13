# Wattprint — Roadmap & Spec

Implemented phases 1 (correctness & trust), 2 (normal-user quality of life),
the Cost Calculator, and the Sleep Mode USP. Phase 3 (power-user:
export/REST/CLI/TOU pricing) and phase 4 (other USP bets) are deliberately out
of scope.

## USP: Sleep Mode — "Keep your music. Kill the waste." (done)

One click before bed: whitelisted apps (default: Spotify, Spotify Web Helper,
chrome — editable in Settings) keep full speed; everything else gets Task
Manager's own Efficiency Mode (EcoQoS + IDLE priority, P/Invoke via the
PowerShell helper, no admin). Throttling re-applies every 60 s to newly
spawned processes. Sessions land in `sleep_sessions` (schema v5) with avg W vs
the trailing 7-day idle+screen-off baseline; the Forecast Insights panel shows "Sleep Mode · last
session" with kWh/$ saved. Trigger: Live view button + tray menu item (win32,
Windows 10 2004+; hidden elsewhere). Windows keeps audible processes at
HighQoS, so music never stutters.

## Phase 1 — Correctness & trust (done)

| Item | What | Where |
|---|---|---|
| P1.1 CPU TDP wired | Collector now uses the hardware-resolved reference TDP instead of a fixed 95 W; exposed as `cpuTdpW`/`cpuTdpResolved` | `service.ts` `primeCollector`, `collector.ts` |
| P1.2 Per-process GPU watts | Measured GPU watts split across processes by WDDM GPU-engine share; new `gpu_w`/`gpu_kwh` columns (schema v4). The synthetic `[GPU Other]` bucket was later removed (see below) — unaccounted GPU time is simply not attributed | `collector.ts` `applyGpuAttribution`, `store.ts` migration v4 |
| P1.3 Adaptive sampling | PowerShell helper poll cadence follows the sample-interval setting; live chart buffer spans ≥2 min at any interval | `hostProcesses.ts` `setPollMs`, `stores.svelte.ts` `setBufferSeconds` |
| P1.4 Dead settings | `startOnLogin` wired to `setLoginItemSettings` (win/mac); `theme` implemented (system/light/dark via `data-theme` + CSS vars) | `ipc.ts`, `style.css`, `Settings.svelte` |
| P1.5 Quick fixes | cost/kWh = 0 allowed; duplicate API decl removed; CSP meta; single-instance lock; window bounds/maximized persisted | `config.ts`, `types.ts`, `index.html`, `index.ts` |
| P1.6 Measured-vs-modeled UI | Every component card carries a measured/estimated/n/a badge; "How accurate?" panel explains each model + TDP; forecast shows measured share | `StatCard.svelte`, `Live.svelte`, `Forecast.svelte` |

## Phase 2 — Normal-user QoL (done)

| Item | What | Where |
|---|---|---|
| P2.1 Live tray widget | State-colored dot icon (green <150 W / amber <400 W / red), tooltip with watts + cost/h + top 3 apps, menu with top 5 apps; dot + tooltip repainted ≤2 s, menu every 5 s | `index.ts` `updateTray` |
| P2.4 Machine-state ledger | Active / Idle (2 min) / Screen-off (5 min) / Sleep (powerMonitor) / Off (startup gap) segments with kWh + avg W; "Where your energy goes" bars in Forecast; 30-day retention | `service.ts` `trackState`, `store.ts` `machine_states`, `Forecast.svelte` |
| P2.5 Insights | Annualized cost + kWh, weekly trend, top apps annualized, "closing X saves $Y/yr", idle-cost share, measured share — refreshed every 60 s in Forecast | `insights.ts`, `Forecast.svelte` |

## Out of scope

- Battery analytics (no laptop to test on)
- Phase 3: CSV/JSON export, localhost REST API, arbitrary-range drill-down,
  hotkeys/CLI, time-of-use / spot pricing
- Phase 4: local-LLM energy meter, cross-platform GPU parity on Linux/macOS

## Recent UX fixes

- Heavy read queries (Top Consumers, Forecast, Insights, hourly history) now run on a
  worker thread with its own SQLite connection, so the UI never blocks or freezes.
- Sleep Mode exit now restores apps reliably: epoch-guarded apply cycles, per-PID
  failure tracking with retry, and a synchronous revert on quit.

- Minimize → taskbar; close → tray (setting-gated, "Close to system tray").
- `[GPU Other]` synthetic process removed from the collector; legacy rows are
  deleted by the schema v5 migration (query filters kept as a safety net).
- Top Consumers shows only significant processes (≥1% of window energy, top 5
  always kept) with a footnote.
- Top Consumers is fixed to the current calendar month (Aug 1 → today). Completed hours
  come from hourly rollups and the in-progress hour merges raw samples
  (`store.ts` `totalsMerged`), so month-long queries stay fast regardless of how large
  the raw samples table is.

## Notes & known limitations

- `sandbox: true` not enabled: the preload bundle is ESM (package `type: module`),
  and sandboxed preloads require CommonJS. Safe because the preload exposes only
  a typed, allowlisted API via `contextBridge` with `contextIsolation: true`.
- Screen-off is approximated by idle > 5 min (no reliable cross-platform event).
- Sleep segments record ≈0 W (no sampling during suspend); Modern Standby
  drain is not measured.
- Alerts were removed on request (feature no longer ships).
- Tray dot icon is generated (`nativeImage.createFromBitmap`, BGRA); it renders
  as a solid color dot — treat color order as cosmetic if it looks off.
