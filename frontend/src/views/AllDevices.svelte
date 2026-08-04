<script lang="ts">
  import PeriodPicker from '../lib/components/PeriodPicker.svelte';
  import StatCard from '../lib/components/StatCard.svelte';
  import LineChart from '../lib/components/LineChart.svelte';
  import { viewHourly, viewTotals, type KeyTotal, type HourlyRollup } from '../lib/wails';
  import { fmtKWh, fmtW, fmtDuration } from '../lib/format';

  type Period = '1h' | '6h' | '24h' | '7d' | '30d';
  let period = $state<Period>('24h');
  let totals = $state<KeyTotal[]>([]);
  let hourly = $state<Record<string, HourlyRollup[]>>({});
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
      const t = await viewTotals(from, to, 'component');
      totals = t;
      // Pull hourly series per component for the stacked chart.
      const h: Record<string, HourlyRollup[]> = {};
      for (const kt of t) {
        h[kt.key] = await viewHourly(from, to, 'component', kt.key);
      }
      hourly = h;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    period;
    load();
  });

  const palette: Record<string, { color: string; label: string }> = {
    cpu:  { color: '#f78166', label: 'CPU' },
    gpu:  { color: '#a371f7', label: 'GPU' },
    ram:  { color: '#3fb950', label: 'RAM' },
    disk: { color: '#d29922', label: 'Disk' },
    net:  { color: '#58a6ff', label: 'Network' },
  };

  let totalKWh = $derived(totals.reduce((s, t) => s + t.kWh, 0));
  let maxKWh = $derived(totals.reduce((m, t) => Math.max(m, t.kWh), 0));
  let totalMinutes = $derived(
    Object.values(hourly).reduce((m, arr) => m + (arr[0]?.minutes ?? 0), 0) / Math.max(1, Object.keys(hourly).length)
  );

  // Build a stacked line chart from each component's hourly avgW.
  let allTimes = $derived(
    Object.values(hourly)[0]?.map((r) => Math.floor(new Date(r.hour).getTime() / 1000)) ?? []
  );
  let chartSeries = $derived(
    totals.map((kt) => ({
      label: palette[kt.key]?.label ?? kt.key,
      color: palette[kt.key]?.color ?? '#7d8590',
      values: (hourly[kt.key] ?? []).map((r) => r.avgW),
    }))
  );
  let chartValues = $derived(chartSeries.map((s) => s.values));
</script>

<div class="view">
  <header>
    <div>
      <h1>All Devices</h1>
      <p class="sub">Where your power is going, broken down by component.</p>
    </div>
    <PeriodPicker bind:value={period} />
  </header>

  <div class="grid">
    <StatCard label="Total" value={fmtKWh(totalKWh)} sub={fmtDuration(totalMinutes / 60) + ' covered'} />
    <StatCard label="Components" value={String(totals.length)} />
    <StatCard label="Top hog" value={totals[0] ? fmtKWh(totals[0].kWh) : '—'} sub={totals[0] ? (palette[totals[0].key]?.label ?? totals[0].key) : ''} />
  </div>

  <LineChart
    title="Average W per hour, by component"
    times={allTimes}
    values={chartValues}
    series={chartSeries.map((s) => ({ label: s.label, color: s.color }))}
    yLabel="W"
    height={300}
  />

  <div class="totals">
    <div class="title">Ranking by kWh</div>
    {#if totals.length === 0}
      <div class="empty">No data yet for this window.</div>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Component</th>
            <th class="num">kWh</th>
            <th class="num">Share</th>
            <th class="num">Avg W</th>
            <th class="num">Peak W</th>
            <th class="bar-col">Bar</th>
          </tr>
        </thead>
        <tbody>
          {#each totals as t (t.key)}
            <tr>
              <td class="name">
                <span class="dot" style="background: {palette[t.key]?.color ?? '#7d8590'}"></span>
                {palette[t.key]?.label ?? t.key}
              </td>
              <td class="num">{fmtKWh(t.kWh)}</td>
              <td class="num">{maxKWh > 0 ? ((t.kWh / totalKWh) * 100).toFixed(1) : '0.0'}%</td>
              <td class="num">{fmtW(t.avgW)}</td>
              <td class="num">{fmtW(t.maxW)}</td>
              <td class="bar-col">
                <div class="bar" style="width: {maxKWh > 0 ? (t.kWh / maxKWh) * 100 : 0}%; background: {palette[t.key]?.color ?? '#7d8590'}"></div>
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
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
  .totals {
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    padding: 14px 16px;
  }
  .totals .title { font-weight: 600; margin-bottom: 10px; color: var(--fg-1); }
  .empty { color: var(--fg-2); font-style: italic; padding: 12px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--border-subtle); font-size: 13px; }
  th { color: var(--fg-2); font-weight: 500; font-size: 11px; text-transform: uppercase; }
  td.num, th.num { text-align: right; font-family: var(--mono); }
  td.name { font-family: var(--mono); color: var(--fg-1); display: flex; align-items: center; gap: 8px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .bar-col { width: 30%; }
  .bar { height: 6px; border-radius: 3px; min-width: 2px; }
  tbody tr:last-child td { border-bottom: none; }
</style>
