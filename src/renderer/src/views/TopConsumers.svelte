<script lang="ts">
  import PeriodPicker from '../lib/components/PeriodPicker.svelte';
  import StatCard from '../lib/components/StatCard.svelte';
  import { viewTotals, type KeyTotal, getSettings, type Settings } from '../lib/wails';
  import { settings } from '../lib/stores.svelte.ts';
  import { fmtKWh, fmtMoney } from '../lib/format';

  type Period = '1h' | '6h' | '24h' | '7d' | '30d';
  let period = $state<Period>('24h');
  let rows = $state<KeyTotal[]>([]);
  let loading = $state(false);

  function periodRange(p: Period): { from: Date; to: Date } {
    const to = new Date();
    const from = new Date(to);
    switch (p) {
      case '1h': from.setHours(from.getHours() - 1); break;
      case '6h': from.setHours(from.getHours() - 6); break;
      case '24h': from.setHours(from.getHours() - 24); break;
      case '7d': from.setDate(from.getDate() - 7); break;
      case '30d': from.setDate(from.getDate() - 30); break;
    }
    return { from, to };
  }

  async function load() {
    loading = true;
    try {
      const { from, to } = periodRange(period);
      rows = await viewTotals(from, to, 'process');
      if (!settings.value) settings.value = await getSettings();
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    period;
    load();
  });

  let totalKWh = $derived(rows.reduce((s, r) => s + r.kWh, 0));
  let totalCost = $derived(totalKWh * (settings.value?.costPerKWh ?? 0));
  let totalCO2 = $derived(totalKWh * (settings.value?.gridCarbonIntensity ?? 0) / 1000);
  let maxKWh = $derived(rows.reduce((m, r) => Math.max(m, r.kWh), 0));
</script>

<div class="view">
  <header>
    <div>
      <h1>Top Consumers</h1>
      <p class="sub">Which apps used the most energy over the selected window.</p>
    </div>
    <PeriodPicker bind:value={period} />
  </header>

  <div class="grid">
    <StatCard label="Total apps" value={String(rows.length)} sub={fmtKWh(totalKWh)} />
    <StatCard
      label="Estimated cost"
      value={fmtMoney(totalCost, settings.value?.currency ?? 'USD')}
      sub={settings.value ? `${settings.value.costPerKWh.toFixed(3)} ${settings.value.currency}/kWh` : ''}
    />
    <StatCard label="Estimated CO₂" value={`${totalCO2.toFixed(2)} kg`} sub={settings.value ? `${settings.value.gridCarbonIntensity} g/kWh grid` : ''} />
  </div>

  <div class="board">
    <div class="title">Leaderboard</div>
    {#if rows.length === 0}
      <div class="empty">No process data yet for this window. Wait a minute or two.</div>
    {:else}
      <table>
        <thead>
          <tr>
            <th style="width: 36px">#</th>
            <th>App</th>
            <th class="num">kWh</th>
            <th class="num">Avg W</th>
            <th class="num">Peak W</th>
            <th class="num">Share</th>
            <th class="bar-col">Bar</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r, i (r.key)}
            <tr>
              <td class="rank">{i + 1}</td>
              <td class="name">{r.key}</td>
              <td class="num">{fmtKWh(r.kWh, 3)}</td>
              <td class="num">{r.avgW.toFixed(1)}</td>
              <td class="num">{r.maxW.toFixed(1)}</td>
              <td class="num">{totalKWh > 0 ? ((r.kWh / totalKWh) * 100).toFixed(1) : '0.0'}%</td>
              <td class="bar-col">
                <div class="bar" style="width: {maxKWh > 0 ? (r.kWh / maxKWh) * 100 : 0}%"></div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<style>
  .view { padding: 24px 28px; overflow-y: auto; display: flex; flex-direction: column; gap: 18px; min-width: 0; }
  header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
  header h1 { margin: 0 0 4px; font-size: 22px; font-weight: 700; }
  header .sub { margin: 0; color: var(--fg-2); font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .board {
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    padding: 14px 16px;
  }
  .board .title { font-weight: 600; margin-bottom: 10px; color: var(--fg-1); }
  .empty { color: var(--fg-2); font-style: italic; padding: 12px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--border-subtle); font-size: 13px; }
  th { color: var(--fg-2); font-weight: 500; font-size: 11px; text-transform: uppercase; }
  td.num, th.num { text-align: right; font-family: var(--mono); }
  td.name { font-family: var(--mono); color: var(--fg-1); }
  td.rank { color: var(--fg-2); font-family: var(--mono); }
  .bar-col { width: 30%; }
  .bar { height: 6px; border-radius: 3px; background: linear-gradient(90deg, #58a6ff, #a371f7); min-width: 2px; }
  tbody tr:last-child td { border-bottom: none; }
</style>
