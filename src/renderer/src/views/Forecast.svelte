<script lang="ts">
  import StatCard from '../lib/components/StatCard.svelte';
  import { viewForecast, getSettings, updateSettings, type ForecastResult, type Settings } from '../lib/wails';
  import { settings } from '../lib/stores.svelte.ts';
  import { fmtKWh, fmtMoney, fmtCO2 } from '../lib/format';

  let result = $state<ForecastResult | null>(null);
  let loading = $state(false);

  // Position percent within a [min, max] range, clamped to [0, 100].
  function pct(value: number, min: number, max: number): number {
    if (max <= min) return 50;
    const p = ((value - min) / (max - min)) * 100;
    if (p < 0) return 0;
    if (p > 100) return 100;
    return p;
  }

  async function load() {
    loading = true;
    try {
      if (!settings.value) settings.value = await getSettings();
      result = await viewForecast();
    } finally {
      loading = false;
    }
  }

  async function setWindow(days: number) {
    if (!settings.value) return;
    const s: Settings = { ...settings.value, forecastWindowDays: days };
    settings.value = s;
    await updateSettings(s);
    await load();
  }

  $effect(() => {
    load();
  });
</script>

<div class="view">
  <header>
    <div>
      <h1>Forecast</h1>
      <p class="sub">Projected monthly energy and cost, based on the trailing window.</p>
    </div>
    <div class="window-pick">
      <button class:active={settings.value?.forecastWindowDays === 7} onclick={() => setWindow(7)}>7 days</button>
      <button class:active={settings.value?.forecastWindowDays === 30} onclick={() => setWindow(30)}>30 days</button>
    </div>
  </header>

  {#if !result || !settings.value}
    <div class="empty">Computing forecast…</div>
  {:else}
    {#if !result.hasEnoughData}
      <div class="warning">
        ⚠ Not enough data yet ({result.hoursCovered.toFixed(1)} h of samples).
        Projections below are based on limited history and will sharpen as Wattprint collects more.
      </div>
    {/if}

    <div class="grid">
      <StatCard
        label="Projected monthly energy"
        value={fmtKWh(result.projectedKWhMonth)}
        sub={`${fmtKWh(result.projectedKWhPerDay)} / day`}
        tone="good"
      />
      <StatCard
        label="Projected monthly cost"
        value={fmtMoney(result.projectedCostMonth, result.currency)}
        sub={`${result.costPerKWh.toFixed(3)} ${result.currency}/kWh`}
        tone="good"
      />
      <StatCard
        label="Projected monthly CO₂"
        value={fmtCO2(result.projectedCO2Kg)}
        sub={`${result.gridCarbonGCO2PerKWh} g/kWh grid`}
      />
      <StatCard
        label="Hourly average"
        value={fmtKWh(result.avgKWhPerHour, 3)}
        sub={`σ ${fmtKWh(result.stdDevKWhPerHour, 3)}`}
      />
    </div>

    <div class="range">
      <div class="title">Confidence range (1σ)</div>
      <div class="bar">
        <div class="track"></div>
        <div
          class="fill"
          style="left: {pct(result.lowKWhMonth, result.lowKWhMonth, result.highKWhMonth)}%; right: {100 - pct(result.highKWhMonth, result.lowKWhMonth, result.highKWhMonth)}%"
        ></div>
        <div
          class="center"
          style="left: {pct(result.projectedKWhMonth, result.lowKWhMonth, result.highKWhMonth)}%"
        ></div>
      </div>
      <div class="ticks">
        <div>
          <div class="tick-label">Low</div>
          <div class="tick-val">{fmtKWh(result.lowKWhMonth)}</div>
          <div class="tick-money">{fmtMoney(result.lowCostMonth, result.currency)}</div>
        </div>
        <div class="center-label">
          <div class="tick-label">Projected</div>
          <div class="tick-val strong">{fmtKWh(result.projectedKWhMonth)}</div>
          <div class="tick-money">{fmtMoney(result.projectedCostMonth, result.currency)}</div>
        </div>
        <div class="right">
          <div class="tick-label">High</div>
          <div class="tick-val">{fmtKWh(result.highKWhMonth)}</div>
          <div class="tick-money">{fmtMoney(result.highCostMonth, result.currency)}</div>
        </div>
      </div>
    </div>

    <div class="meta">
      <div>
        <span class="key">Window</span>
        <span class="val">{result.windowDays} days · {result.hoursCovered.toFixed(1)} h covered</span>
      </div>
      <div>
        <span class="key">Observed in window</span>
        <span class="val">{fmtKWh(result.kWhInWindow)}</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .view { padding: 24px 28px; overflow-y: auto; display: flex; flex-direction: column; gap: 18px; min-width: 0; }
  header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
  header h1 { margin: 0 0 4px; font-size: 22px; font-weight: 700; }
  header .sub { margin: 0; color: var(--fg-2); font-size: 13px; }
  .window-pick {
    display: inline-flex;
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    overflow: hidden;
  }
  .window-pick button {
    background: transparent; border: none; color: var(--fg-1);
    padding: 6px 14px; font-size: 12px; font-family: var(--mono); border-radius: 0;
  }
  .window-pick button + button { border-left: 1px solid var(--border-subtle); }
  .window-pick button.active { background: var(--accent); color: #0d1117; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .warning {
    background: rgba(210, 153, 34, 0.1);
    border: 1px solid rgba(210, 153, 34, 0.3);
    color: var(--warn);
    padding: 10px 14px;
    border-radius: 6px;
    font-size: 13px;
  }
  .empty { color: var(--fg-2); font-style: italic; padding: 24px 0; text-align: center; }
  .range {
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    padding: 16px 20px;
  }
  .range .title { font-weight: 600; margin-bottom: 16px; color: var(--fg-1); }
  .bar {
    position: relative;
    height: 8px;
    margin: 0 0 16px;
  }
  .track { position: absolute; inset: 0; background: var(--bg-3); border-radius: 4px; }
  .fill {
    position: absolute;
    top: 0; bottom: 0;
    background: linear-gradient(90deg, #58a6ff, #a371f7);
    border-radius: 4px;
  }
  .center {
    position: absolute;
    top: -4px; bottom: -4px;
    width: 3px;
    background: var(--fg-0);
    border-radius: 2px;
    transform: translateX(-50%);
  }
  .ticks { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .tick-label { color: var(--fg-2); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  .tick-val { font-family: var(--mono); font-size: 16px; font-weight: 600; }
  .tick-val.strong { color: var(--accent); }
  .tick-money { color: var(--fg-1); font-size: 12px; }
  .center-label { text-align: center; }
  .right { text-align: right; }
  .meta {
    display: flex; gap: 32px; padding: 4px 4px; color: var(--fg-2); font-size: 12px;
  }
  .meta .key { margin-right: 6px; }
  .meta .val { color: var(--fg-1); font-family: var(--mono); }
</style>
