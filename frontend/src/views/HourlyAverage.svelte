<script lang="ts">
  import PeriodPicker from '../lib/components/PeriodPicker.svelte';
  import LineChart from '../lib/components/LineChart.svelte';
  import StatCard from '../lib/components/StatCard.svelte';
  import { viewHourly, type HourlyRollup } from '../lib/wails';
  import { fmtW, fmtKWh, fmtDuration } from '../lib/format';

  type Period = '1h' | '6h' | '24h' | '7d' | '30d';
  type Comp = 'cpu' | 'gpu' | 'ram' | 'disk' | 'net';

  let period = $state<Period>('24h');
  let selected = $state<Comp>('cpu');
  let data = $state<HourlyRollup[]>([]);
  let loading = $state(false);

  const comps: { id: Comp; label: string; color: string }[] = [
    { id: 'cpu', label: 'CPU', color: '#f78166' },
    { id: 'gpu', label: 'GPU', color: '#a371f7' },
    { id: 'ram', label: 'RAM', color: '#3fb950' },
    { id: 'disk', label: 'Disk', color: '#d29922' },
    { id: 'net', label: 'Net', color: '#58a6ff' },
  ];

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
      data = await viewHourly(from, to, 'component', selected);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    period; selected;
    load();
  });

  let totalKWh = $derived(data.reduce((s, r) => s + r.kWh, 0));
  let avgW = $derived(
    data.length > 0 ? data.reduce((s, r) => s + r.avgW * r.minutes, 0) /
      Math.max(1, data.reduce((s, r) => s + r.minutes, 0)) : 0
  );
  let maxW = $derived(data.reduce((m, r) => Math.max(m, r.maxW), 0));
  let minutes = $derived(data.reduce((s, r) => s + r.minutes, 0));

  let times = $derived(data.map((r) => Math.floor(new Date(r.hour).getTime() / 1000)));
  let avgSeries = $derived(data.map((r) => r.avgW));
  let maxSeries = $derived(data.map((r) => r.maxW));
</script>

<div class="view">
  <header>
    <div>
      <h1>Hourly Average</h1>
      <p class="sub">Per-hour buckets over the selected window — distinct from live samples.</p>
    </div>
    <PeriodPicker bind:value={period} />
  </header>

  <div class="picker">
    {#each comps as c (c.id)}
      <button class="chip" class:active={selected === c.id} onclick={() => (selected = c.id)}>
        <span class="dot" style="background: {c.color}"></span>{c.label}
      </button>
    {/each}
  </div>

  <div class="grid">
    <StatCard label="Total" value={fmtKWh(totalKWh)} sub={fmtDuration(minutes / 60) + ' covered'} />
    <StatCard label="Average" value={fmtW(avgW)} />
    <StatCard label="Peak hour" value={fmtW(maxW)} />
  </div>

  <LineChart
    title="{comps.find((c) => c.id === selected)?.label ?? ''} — average & peak W per hour"
    times={times}
    values={[avgSeries, maxSeries]}
    series={[
      { label: 'Average W', color: comps.find((c) => c.id === selected)?.color ?? '#58a6ff' },
      { label: 'Peak W', color: '#7d8590' },
    ]}
    yLabel="W"
    height={280}
  />
</div>

<style>
  .view {
    padding: 24px 28px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-width: 0;
  }
  header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
  }
  header h1 { margin: 0 0 4px; font-size: 22px; font-weight: 700; }
  header .sub { margin: 0; color: var(--fg-2); font-size: 13px; }
  .picker { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip {
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    color: var(--fg-1);
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .chip:hover { background: var(--bg-2); }
  .chip.active { background: var(--bg-2); border-color: var(--accent); color: var(--fg-0); }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
  }
</style>
