<script lang="ts">
  import StatCard from '../lib/components/StatCard.svelte';
  import Icon from '../lib/components/Icon.svelte';
  import { viewForecast, getSettings, viewMachineStates, getInsights, getSleepSessions, getBenchmark, type ForecastResult, type Settings, type MachineStateRow, type Insights, type SleepSession, type Benchmark } from '../lib/wails';
  import { settings } from '../lib/stores.svelte.ts';
  import { fmtKWh, fmtMoney, fmtEnergy, fmtDuration, fmtDate } from '../lib/format';

  let result = $state<ForecastResult | null>(null);
  let insights = $state<Insights | null>(null);
  let states = $state<MachineStateRow[]>([]);
  let sleepSessions = $state<SleepSession[]>([]);
  let benchmark = $state<Benchmark | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

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
    error = null;
    try {
      if (!settings.value) settings.value = await getSettings();
      const [forecast, insight, stateRows, sessionRows, bench] = await Promise.all([
        viewForecast(),
        getInsights(),
        viewMachineStates(new Date(Date.now() - 30 * 24 * 3600 * 1000), new Date()),
        getSleepSessions(new Date(Date.now() - 30 * 24 * 3600 * 1000), new Date()),
        getBenchmark(),
      ]);
      result = forecast;
      insights = insight;
      states = stateRows;
      sleepSessions = sessionRows;
      benchmark = bench;
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  });

  const stateMeta: { id: string; label: string; color: string }[] = [
    { id: 'active', label: 'Active', color: 'var(--chart-blue)' },
    { id: 'idle', label: 'Idle', color: 'var(--chart-violet)' },
    { id: 'screen-off', label: 'Screen off', color: 'var(--chart-amber)' },
    { id: 'sleep', label: 'Sleep', color: 'var(--fg-2)' },
    { id: 'off', label: 'Off', color: 'var(--bg-3)' },
  ];

  let stateTotals = $derived.by(() => {
    const byId = new Map<string, { kWh: number; hours: number }>();
    for (const row of states) {
      const cur = byId.get(row.state) ?? { kWh: 0, hours: 0 };
      const hours = (new Date(row.to).getTime() - new Date(row.from).getTime()) / 3600000;
      cur.kWh += row.kWh;
      cur.hours += hours;
      byId.set(row.state, cur);
    }
    const total = [...byId.values()].reduce((sum, v) => sum + v.kWh, 0);
    return { byId, total };
  });

  let stateRows = $derived(
    stateMeta
      .map((meta) => {
        const data = stateTotals.byId.get(meta.id);
        return {
          ...meta,
          kWh: data?.kWh ?? 0,
          hours: data?.hours ?? 0,
          share: stateTotals.total > 0 ? ((data?.kWh ?? 0) / stateTotals.total) * 100 : 0,
        };
      })
      .filter((r) => r.hours > 0.01)
  );

  let maxStateShare = $derived(stateRows.reduce((m, r) => Math.max(m, r.share), 0));

  let idleAvgW = $derived.by(() => {
    const rows = states.filter((r) => r.state === 'idle' || r.state === 'screen-off');
    if (rows.length === 0) return null;
    const totalMs = rows.reduce((sum, r) => sum + (new Date(r.to).getTime() - new Date(r.from).getTime()), 0);
    if (totalMs <= 0) return null;
    return rows.reduce((sum, r) => sum + r.avgW * (new Date(r.to).getTime() - new Date(r.from).getTime()), 0) / totalMs;
  });

  let trendText = $derived(
    insights?.weeklyTrendPct == null
      ? '—'
      : insights.weeklyTrendPct >= 0
        ? `+${insights.weeklyTrendPct.toFixed(1)}% vs last week`
        : `${insights.weeklyTrendPct.toFixed(1)}% vs last week`
  );

  let lastSleep = $derived(sleepSessions.length > 0 ? sleepSessions[sleepSessions.length - 1] : null);

  function fmtYearKWh(kwh: number): string {
    return `${Math.round(kwh).toLocaleString()} kWh/yr`;
  }

  let benchRows = $derived.by(() => {
    if (!benchmark) return [];
    const rows: { label: string; value: number; color: string; note?: string }[] = [
      { label: 'Your projected', value: benchmark.projectedKWhYear, color: 'var(--chart-blue)', note: 'if this average held all year' },
      { label: 'Desktop PC', value: benchmark.desktop.medianKWhYear ?? benchmark.desktop.avgKWhYear, color: 'var(--fg-2)', note: benchmark.desktop.medianKWhYear != null ? `median · ${benchmark.desktop.source}` : benchmark.desktop.source },
      { label: 'Desktop PC average', value: benchmark.desktop.avgKWhYear, color: 'var(--fg-2)', note: benchmark.desktop.source },
      { label: 'Gaming desktop', value: benchmark.gaming.avgKWhYear, color: 'var(--chart-violet)', note: benchmark.gaming.source },
    ];
    const max = Math.max(...rows.map((r) => r.value));
    return rows.map((r) => ({ ...r, bar: max > 0 ? (r.value / max) * 100 : 0 }));
  });

  let benchQuality = $derived.by(() => {
    if (!benchmark?.firstTrackedAt) return { text: '', tone: '' };
    const h = benchmark.coveredHours;
    if (h < 24) return { text: `Preview — ${fmtDuration(h)} tracked so far; the comparison sharpens as Wattprint keeps running.`, tone: 'warn' };
    if (h < 168) return { text: `Stabilizing — ${fmtDuration(h)} tracked. A week of tracking makes this comparison solid.`, tone: 'warn' };
    return { text: `Reliable — based on ${fmtDuration(h)} of tracked history.`, tone: 'good' };
  });

  let householdSharePct = $derived(
    benchmark && benchmark.projectedKWhYear > 0 && benchmark.household.avgKWhYear > 0
      ? (benchmark.projectedKWhYear / benchmark.household.avgKWhYear) * 100
      : null
  );

  let sleepText = $derived.by(() => {
    if (!lastSleep) return null;
    const hours = (new Date(lastSleep.end).getTime() - new Date(lastSleep.start).getTime()) / 3600000;
    if (lastSleep.savedKWh > 0) {
      return {
        value: fmtMoney(lastSleep.savedKWh * (settings.value?.costPerKWh ?? 0), settings.value?.currency ?? 'USD'),
        sub: `${fmtEnergy(lastSleep.savedKWh, 3)} saved · ${hours.toFixed(1)} h · ${lastSleep.throttledCount} apps throttled`,
      };
    }
    return {
      value: fmtEnergy(lastSleep.kWh),
      sub: `${hours.toFixed(1)} h · ${lastSleep.throttledCount} apps throttled · no baseline yet`,
    };
  });
</script>

<div class="view">
  <header class="page-header">
    <div>
      <h1>Forecast</h1>
      <p class="sub">Projected monthly energy and cost, based on the trailing 30 days of hourly history.</p>
    </div>
  </header>

  {#if error}
    <div class="error-box" role="alert">
      <span>Couldn't load the forecast: {error}</span>
      <button type="button" onclick={load}>Retry</button>
    </div>
  {/if}

  {#if !result || !settings.value}
    <div class="empty">Computing forecast…</div>
  {:else}
    {#if result.hoursCovered === 0}
      <div class="warning">
        No completed hourly history yet. Keep Wattprint running; the status bar above shows when the first forecast bucket arrives.
      </div>
    {:else}
      {#if !result.hasEnoughData}
        <div class="warning">
          <span class="warn-icon"><Icon name="warn" size={14} /></span>
          Not enough data yet ({result.hoursCovered.toFixed(1)} h of samples).
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

      {#if insights}
        <section class="panel" aria-label="Insights">
          <div class="panel-title">Insights</div>
          <div class="insight-grid">
            <div class="insight-card">
              <span class="k">Projected annual cost</span>
              <strong>{fmtMoney(insights.annualCost, settings.value.currency)}</strong>
              <span class="v">{fmtKWh(insights.annualKWh)} / year</span>
            </div>
            <div class="insight-card">
              <span class="k">Trend</span>
              <strong class:good={trendText.startsWith('-')} class:warn={trendText.startsWith('+')}>{trendText}</strong>
              <span class="v">component energy</span>
            </div>
            <div class="insight-card">
              <span class="k">Measured energy</span>
              <strong>{insights.measuredSharePct == null ? '—' : `${insights.measuredSharePct.toFixed(0)}%`}</strong>
              <span class="v">of window kWh from real sensors</span>
            </div>
            <div class="insight-card">
              <span class="k">Idle & screen-off</span>
              <strong>{fmtMoney(insights.idleCost, settings.value.currency)}</strong>
              <span class="v">{fmtEnergy(insights.idleKWh)} · {insights.idleSharePct.toFixed(0)}% of ledger</span>
            </div>
            {#if sleepText}
              <div class="insight-card">
                <span class="k">Sleep Mode · last session</span>
                <strong>{sleepText.value}</strong>
                <span class="v">{sleepText.sub}</span>
              </div>
            {/if}
          </div>
          {#if insights.savings.length > 0}
            <div class="savings">
              <div class="savings-title">Closing these could save about</div>
              {#each insights.savings as app (app.key)}
                <div class="saving-row">
                  <span class="saving-app">{app.key}</span>
                  <span class="saving-val">{fmtMoney(app.annualCost, settings.value.currency)}/yr</span>
                </div>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      {#if stateRows.length > 0}
        <section class="panel" aria-label="Where your energy goes">
          <div class="panel-title">
            Where your energy goes
            {#if idleAvgW != null}
              <span class="panel-sub">· idle draw ≈ {idleAvgW.toFixed(1)} W</span>
            {/if}
          </div>
          <div class="state-list">
            {#each stateRows as row (row.id)}
              <div class="state-row">
                <span class="state-label"><span class="dot" style="background: {row.color}"></span>{row.label}</span>
                <div class="state-bar-track">
                  <div class="state-bar" style="width: {maxStateShare > 0 ? Math.max(2, (row.share / maxStateShare) * 100) : 0}%; background: {row.color}"></div>
                </div>
                <span class="state-nums">
                  {fmtEnergy(row.kWh)} · {fmtMoney(row.kWh * (settings.value?.costPerKWh ?? 0), settings.value?.currency ?? 'USD')} · {fmtDuration(row.hours)}
                </span>
              </div>
            {/each}
          </div>
          <p class="state-note">Sleep and off hours draw ≈0 W at the wall for desktops; laptops in Modern Standby are not measured here.</p>
        </section>
      {/if}

      <div class="meta">
        <div>
          <span class="key">Window</span>
          <span class="val">{result.windowDays} days · {result.hoursCovered.toFixed(1)} h covered</span>
        </div>
        <div>
          <span class="key">Observed in window</span>
          <span class="val">{fmtKWh(result.kWhInWindow)}</span>
        </div>
        <div>
          <span class="key">Measured share</span>
          <span class="val">{result.measuredSharePct.toFixed(1)}% (GPU sensors)</span>
        </div>
      </div>
    {/if}

    {#if benchmark}
      <section class="panel" aria-label="How you compare">
        <div class="panel-title">
          How you compare
          {#if benchmark.firstTrackedAt}
            <span class="panel-sub">· {fmtDuration(benchmark.coveredHours)} running · {fmtDuration(benchmark.activeHours)} active across {fmtDuration(Math.max(1, (Date.now() - new Date(benchmark.firstTrackedAt).getTime()) / 3600000))} since {fmtDate(benchmark.firstTrackedAt)}</span>
          {/if}
        </div>
        {#if !benchmark.firstTrackedAt}
          <p class="state-note">No tracking history yet — keep Wattprint running and this panel fills in.</p>
        {:else}
          <div class="quality {benchQuality.tone}">{benchQuality.text}</div>
          <div class="bench-list">
            {#each benchRows as row (row.label)}
              <div class="bench-row">
                <span class="bench-label">
                  {row.label}
                  {#if row.note}<span class="bench-src">{row.note}</span>{/if}
                </span>
                <div class="state-bar-track">
                  <div class="state-bar" style="width: {Math.max(2, row.bar)}%; background: {row.color}"></div>
                </div>
                <span class="state-nums">{fmtYearKWh(row.value)}</span>
              </div>
            {/each}
          </div>
          <p class="state-note">
            Your projected {fmtYearKWh(benchmark.projectedKWhYear)} is
            {benchmark.projectedKWhYear < (benchmark.desktop.medianKWhYear ?? benchmark.desktop.avgKWhYear)
              ? 'below the typical desktop PC'
              : benchmark.projectedKWhYear < benchmark.desktop.avgKWhYear
                ? 'below the average desktop PC'
                : benchmark.projectedKWhYear < benchmark.gaming.avgKWhYear
                  ? 'above the average desktop PC, below a typical gaming rig'
                  : 'in gaming-rig territory'}.
            {#if householdSharePct != null}
              That's about {householdSharePct.toFixed(0)}% of a {benchmark.household.label} average ({fmtYearKWh(benchmark.household.avgKWhYear)}).
            {/if}
          </p>
          <p class="state-note">
            References: {benchmark.desktop.label} — {benchmark.desktop.source} ({benchmark.desktop.asOf}); {benchmark.gaming.label} — {benchmark.gaming.source} ({benchmark.gaming.asOf}); {benchmark.household.label} — {benchmark.household.source} ({benchmark.household.asOf}). Averages vary widely with usage and hardware — treat these as orientation.
          </p>
        {/if}
      </section>
    {/if}
  {/if}
</div>

<style>
  header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
  header h1 { margin: 0 0 4px; font-size: 22px; font-weight: 700; }
  header .sub { margin: 0; color: var(--fg-2); font-size: 13px; }
  .error-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-radius: var(--radius);
    background: var(--danger-soft);
    border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border-subtle));
    color: var(--fg-1);
    font-size: 13px;
  }
  .error-box button {
    background: var(--bg-2);
    border: 1px solid var(--border);
    color: var(--fg-0);
    padding: 4px 12px;
    border-radius: 6px;
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .warning {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: var(--warn-soft);
    border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
    color: var(--warn);
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    font-size: 13px;
  }
  .warn-icon { flex-shrink: 0; margin-top: 1px; }
  .empty { color: var(--fg-2); font-style: italic; padding: 24px 0; text-align: center; }
  .panel {
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    padding: 14px 16px;
  }
  .panel-title { font-weight: 600; margin-bottom: 12px; color: var(--fg-1); }
  .panel-sub { font-weight: 400; color: var(--fg-2); font-size: 12px; }
  .insight-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
  .insight-card {
    display: flex; flex-direction: column; gap: 2px;
    padding: 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 9px;
    background: color-mix(in srgb, var(--bg-2) 35%, var(--bg-1));
  }
  .insight-card .k { color: var(--fg-2); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
  .insight-card strong { font-family: var(--mono); font-size: 17px; }
  .insight-card .v { color: var(--fg-2); font-size: 11px; }
  .insight-card strong.good { color: var(--accent-2); }
  .insight-card strong.warn { color: var(--warn); }
  .savings { margin-top: 12px; }
  .savings-title { color: var(--fg-2); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
  .saving-row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 2px; border-bottom: 1px solid var(--border-subtle); font-size: 13px; }
  .saving-row:last-child { border-bottom: none; }
  .saving-app { font-family: var(--mono); color: var(--fg-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .saving-val { color: var(--fg-0); font-family: var(--mono); white-space: nowrap; }
  .quality { padding: 8px 12px; margin-bottom: 12px; border-radius: var(--radius-sm); font-size: 12px; }
  .quality.warn { background: var(--warn-soft); border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent); color: var(--warn); }
  .quality.good { background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); color: var(--accent); }
  .bench-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
  .bench-row { display: grid; grid-template-columns: 190px 1fr auto; align-items: center; gap: 12px; }
  .bench-label { display: flex; flex-direction: column; color: var(--fg-1); font-size: 12px; }
  .bench-src { color: var(--fg-2); font-size: 10px; }
  @media (max-width: 640px) { .bench-row { grid-template-columns: 1fr; gap: 4px; } }
  .state-list { display: flex; flex-direction: column; gap: 8px; }
  .state-row { display: grid; grid-template-columns: 130px 1fr auto; align-items: center; gap: 12px; }
  .state-label { display: flex; align-items: center; gap: 8px; color: var(--fg-1); font-size: 12px; }
  .state-label .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .state-bar-track { height: 8px; background: var(--bg-3); border-radius: 999px; overflow: hidden; }
  .state-bar { height: 100%; border-radius: 999px; min-width: 2px; }
  .state-nums { color: var(--fg-2); font-family: var(--mono); font-size: 11px; white-space: nowrap; }
  .state-note { margin: 10px 0 0; color: var(--fg-2); font-size: 11px; }
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
  .track { position: absolute; inset: 0; background: var(--bg-3); border-radius: 999px; }
  .fill {
    position: absolute;
    top: 0; bottom: 0;
    background: linear-gradient(90deg, var(--chart-blue), var(--chart-violet));
    border-radius: 999px;
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
    display: flex; gap: 32px; padding: 4px 4px; color: var(--fg-2); font-size: 12px; flex-wrap: wrap;
  }
  .meta .key { margin-right: 6px; }
  .meta .val { color: var(--fg-1); font-family: var(--mono); }
  @media (max-width: 640px) { .state-row { grid-template-columns: 1fr; gap: 4px; } }
</style>
