<script lang="ts">
  import StatCard from '../lib/components/StatCard.svelte';
  import { viewTotals, getTrackingInfo, getSettings, type KeyTotal, type Settings, type TrackingInfo } from '../lib/wails';
  import { settings } from '../lib/stores.svelte.ts';
  import { fmtEnergy, fmtMoney, fmtDuration } from '../lib/format';
  import { nextSort, sortIndicator, ariaSort } from '../lib/sort';

  const MONTH_HOURS = 24 * 30;

  function monthStart(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  let from = monthStart();
  let rows = $state<KeyTotal[]>([]);
  let tracking = $state<TrackingInfo | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      from = monthStart();
      tracking = await getTrackingInfo(from.toISOString());
      rows = await viewTotals(from, new Date(), 'process');
      if (!settings.value) settings.value = await getSettings();
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

  let monthLabel = $derived(
    `${from.toLocaleDateString([], { month: 'long' })} 1 – ${new Date().getDate()}`
  );

  let totalKWh = $derived(rows.reduce((s, r) => s + r.kWh, 0));
  let totalCost = $derived(totalKWh * (settings.value?.costPerKWh ?? 0));
  let maxKWh = $derived(rows.reduce((m, r) => Math.max(m, r.kWh), 0));

  /** Projected monthly energy for one app: measured energy scaled to a full
   *  month at the same intensity (matches the forecast's method). */
  function kWhPerMonth(r: KeyTotal): number {
    const hours = tracking?.coveredHours ?? 0;
    return hours > 0 ? (r.kWh / hours) * MONTH_HOURS : 0;
  }

  /** Wall-clock hours from the month start to now, and how much of it was
   *  actually tracked — sparse on/off usage shows up here as a small %.
   *  coveredHours is clamped to the span as display insurance: tracked time
   *  can never exceed the window. activeHours (real user activity) is a
   *  subset of running time. */
  let spanHours = $derived(Math.max(1, (Date.now() - from.getTime()) / 3600000));
  let coveredHoursRaw = $derived(tracking?.coveredHours ?? 0);
  let coveredHours = $derived(Math.min(coveredHoursRaw, spanHours));
  let activeHours = $derived(Math.min(tracking?.activeHours ?? 0, coveredHours));
  let coveragePct = $derived(Math.min(100, (coveredHours / spanHours) * 100));
  let activePct = $derived(coveredHours > 0 ? (activeHours / coveredHours) * 100 : 0);

  let totalKWhPerMonth = $derived(
    coveredHours > 0 ? (totalKWh / coveredHours) * MONTH_HOURS : 0
  );
  let totalCostPerMonth = $derived(totalKWhPerMonth * (settings.value?.costPerKWh ?? 0));

  let sortKey = $state<'key' | 'kWh' | 'avgW' | 'maxW' | 'share'>('kWh');
  let sortDir = $state<'asc' | 'desc'>('desc');

  function toggleSort(key: 'key' | 'kWh' | 'avgW' | 'maxW' | 'share') {
    const next = nextSort(sortKey, sortDir, key, ['key']);
    sortKey = next.key;
    sortDir = next.dir;
  }

  function indicator(key: 'key' | 'kWh' | 'avgW' | 'maxW' | 'share'): string {
    return sortIndicator(key, sortKey, sortDir);
  }

  function tableAriaSort(key: 'key' | 'kWh' | 'avgW' | 'maxW' | 'share') {
    return ariaSort(key, sortKey, sortDir);
  }

  function shareOf(r: KeyTotal): number {
    return totalKWh > 0 ? (r.kWh / totalKWh) * 100 : 0;
  }

  function gpuTitle(r: KeyTotal): string {
    if (r.gpuKWh <= 0) return '';
    return `CPU ${fmtEnergy(r.kWh - r.gpuKWh, 3)} · GPU ${fmtEnergy(r.gpuKWh, 3)}`;
  }

  // Only significant processes: ≥1% share of month energy, always keeping
  // the top 5 by kWh so the leaderboard never looks empty.
  let visibleRows = $derived.by(() => {
    const byKwh = [...rows].sort((a, b) => b.kWh - a.kWh);
    const total = byKwh.reduce((s, r) => s + r.kWh, 0);
    if (total <= 0 || byKwh.length <= 5) return byKwh;
    const merged = new Map<string, KeyTotal>();
    for (const r of byKwh.slice(0, 5)) merged.set(r.key, r);
    for (const r of byKwh) {
      if (r.kWh / total >= 0.01) merged.set(r.key, r);
    }
    return [...merged.values()];
  });

  let filteredCount = $derived(rows.length - visibleRows.length);

  let sortedRows = $derived.by(() => {
    const list = [...visibleRows];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      switch (sortKey) {
        case 'key': return a.key.localeCompare(b.key) * dir;
        case 'share': return (shareOf(a) - shareOf(b)) * dir;
        default: return (a[sortKey] - b[sortKey]) * dir;
      }
    });
    return list;
  });
</script>

<div class="view">
  <header class="page-header">
    <div>
      <h1>Top Consumers</h1>
      <p class="sub">
        Which apps used the most energy this month
        {#if tracking && tracking.firstTrackedAt}
          — {fmtDuration(coveredHours)} of running across {fmtDuration(spanHours)} ({monthLabel}).
        {:else}
          — nothing tracked yet.
        {/if}
      </p>
    </div>
    <span class="month-chip">{monthLabel}</span>
  </header>

  <div class="grid">
    <StatCard
      label="Energy this month"
      value={fmtEnergy(totalKWh)}
      sub={`${monthLabel} · ${fmtDuration(coveredHours)} of ${fmtDuration(spanHours)} running (${coveragePct.toFixed(0)}%)`}
      bar={coveragePct}
      barLabel={`${fmtDuration(coveredHours)} of running time across the ${fmtDuration(spanHours)} month window (${coveragePct.toFixed(0)}%)`}
      hint="Wall-clock hours the app was running in the background — tray monitoring counts, even when minimized."
    />
    <StatCard
      label="Estimated cost this month"
      value={fmtMoney(totalCost, settings.value?.currency ?? 'USD')}
      sub={settings.value ? `${settings.value.costPerKWh.toFixed(3)} ${settings.value.currency}/kWh` : ''}
    />
    <StatCard
      label="Active use"
      value={fmtDuration(activeHours)}
      sub={coveredHours > 0 ? `${fmtDuration(activeHours)} of ${fmtDuration(coveredHours)} running (${activePct.toFixed(0)}%)` : 'no tracked time yet'}
      bar={activePct}
      barLabel={`${fmtDuration(activeHours)} of real user activity across ${fmtDuration(coveredHours)} of running (${activePct.toFixed(0)}%)`}
      hint="Hours with real user activity — idle, screen-off, and sleep don't count."
    />
  </div>

  {#if loading && rows.length === 0}
    <div class="empty">Loading this month's data…</div>
  {/if}

  {#if error}
    <div class="error-box" role="alert">
      <span>Couldn't load this month's data: {error}</span>
      <button type="button" onclick={load}>Retry</button>
    </div>
  {/if}

  <div class="board">
    <div class="title">
      Leaderboard
      <span class="filter-note">
        {monthLabel} · {#if tracking}scaled to a full month: ≈ {fmtEnergy(totalKWhPerMonth)} · {fmtMoney(totalCostPerMonth, settings.value?.currency ?? 'USD')}{/if}
      </span>
      {#if filteredCount > 0}
        <span class="filter-note">· {filteredCount} below 1% hidden</span>
      {/if}
    </div>
    {#if visibleRows.length === 0}
      <div class="empty">No process data this month yet. The status bar above shows when collection is ready.</div>
    {:else}
      <table>
        <caption class="sr-only">Monthly energy consumption leaderboard</caption>
        <thead>
          <tr>
            <th style="width: 36px">#</th>
            <th aria-sort={tableAriaSort('key')}><button class="sort-btn" class:active={sortKey === 'key'} onclick={() => toggleSort('key')}>App {indicator('key')}</button></th>
            <th class="num" aria-sort={tableAriaSort('kWh')}><button class="sort-btn" class:active={sortKey === 'kWh'} onclick={() => toggleSort('kWh')}>kWh this month {indicator('kWh')}</button></th>
            <th class="num" title="Projected monthly energy at this month's intensity">kWh/mo</th>
            <th class="num" aria-sort={tableAriaSort('avgW')}><button class="sort-btn" class:active={sortKey === 'avgW'} onclick={() => toggleSort('avgW')}>Avg W {indicator('avgW')}</button></th>
            <th class="num" aria-sort={tableAriaSort('maxW')}><button class="sort-btn" class:active={sortKey === 'maxW'} onclick={() => toggleSort('maxW')}>Peak W {indicator('maxW')}</button></th>
            <th class="num" aria-sort={tableAriaSort('share')}><button class="sort-btn" class:active={sortKey === 'share'} onclick={() => toggleSort('share')}>Share {indicator('share')}</button></th>
            <th class="bar-col">Bar</th>
          </tr>
        </thead>
        <tbody>
          {#each sortedRows as r, i (r.key)}
            <tr>
              <td class="rank" class:top={i < 3}>{i + 1}</td>
              <td class="name">{r.key}</td>
              <td class="num" title={gpuTitle(r)}>{fmtEnergy(r.kWh, 3)}</td>
              <td class="num muted">{fmtEnergy(kWhPerMonth(r), 3)}</td>
              <td class="num">{r.avgW.toFixed(1)}</td>
              <td class="num">{r.maxW.toFixed(1)}</td>
              <td class="num">{shareOf(r).toFixed(1)}%</td>
              <td class="bar-col">
                <div class="bar" style="width: {maxKWh > 0 ? (r.kWh / maxKWh) * 100 : 0}%"></div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <p class="footnote">Process history is recorded every 5 s to keep overhead low; hourly energy totals are unaffected.</p>
</div>

<style>
  header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
  header h1 { margin: 0 0 4px; font-size: 22px; font-weight: 700; }
  header .sub { margin: 0; color: var(--fg-2); font-size: 13px; }
  .month-chip {
    padding: 5px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    background: var(--bg-1);
    color: var(--fg-1);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .board {
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    padding: 14px 16px;
  }
  .filter-note { color: var(--fg-2); font-size: 11px; font-weight: 400; margin-left: 8px; }
  .board .title { font-weight: 600; margin-bottom: 10px; color: var(--fg-1); }
  .footnote { margin: 4px 0 0; color: var(--fg-2); font-size: 11px; }
  .error-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--danger) 10%, var(--bg-1));
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
  .empty { color: var(--fg-2); font-style: italic; padding: 12px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--border-subtle); font-size: 13px; }
  th { color: var(--fg-2); font-weight: 500; font-size: 11px; text-transform: uppercase; }
  .sort-btn { background: none; border: none; padding: 0; color: inherit; font: inherit; text-transform: inherit; letter-spacing: inherit; cursor: pointer; }
  .sort-btn.active { color: var(--fg-0); }
  th:not(.num) .sort-btn { text-align: left; }
  th.num .sort-btn { text-align: right; }
  td.num, th.num { text-align: right; font-family: var(--mono); }
  td.name { font-family: var(--mono); color: var(--fg-1); }
  td.rank { color: var(--fg-2); font-family: var(--mono); }
  td.rank.top { color: var(--accent); font-weight: 600; }
  td.muted { color: var(--fg-2); }
  .bar-col { width: 30%; }
  .bar { height: 4px; border-radius: 999px; background: linear-gradient(90deg, var(--chart-blue), var(--chart-violet)); min-width: 2px; }
  tbody tr { transition: background var(--dur-fast) ease; }
  tbody tr:hover { background: color-mix(in srgb, var(--bg-2) 55%, transparent); }
  tbody tr:last-child td { border-bottom: none; }
</style>
