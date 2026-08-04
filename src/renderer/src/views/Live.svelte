<script lang="ts">
  import { snapshot, liveBuffer, systemInfo } from '../lib/stores.svelte.ts';
  import StatCard from '../lib/components/StatCard.svelte';
  import LineChart from '../lib/components/LineChart.svelte';
  import { fmtW, fmtTime } from '../lib/format';

  // Derive live time series from the rolling buffer.
  let times = $derived(liveBuffer.samples.map((s) => Math.floor(new Date(s.ts).getTime() / 1000)));
  let totalSeries = $derived(liveBuffer.samples.map((s) => s.totalW));
  let cpuSeries = $derived(liveBuffer.samples.map((s) => s.components.cpu ?? 0));
  let gpuSeries = $derived(liveBuffer.samples.map((s) => s.components.gpu ?? 0));
  let ramSeries = $derived(liveBuffer.samples.map((s) => s.components.ram ?? 0));
  let diskSeries = $derived(liveBuffer.samples.map((s) => s.components.disk ?? 0));
  let netSeries = $derived(liveBuffer.samples.map((s) => s.components.net ?? 0));

  let topProcesses = $derived(
    [...(snapshot.latest?.processes ?? [])].sort((a, b) => b.w - a.w).slice(0, 8)
  );

  // System info strip text
  let sysText = $derived.by(() => {
    const s = systemInfo.value
    if (!s) return null
    const cpu = s.cpu
    const mem = (s.memoryTotalBytes / (1024 ** 3)).toFixed(0)
    const gpus = s.gpus.length === 0
      ? 'no GPU'
      : s.gpus.map((g) => `${g.vendor} ${g.model}`.trim()).join(', ')
    return `${cpu.brand} · ${cpu.physicalCores}C/${cpu.cores}T · ${cpu.speedGHz.toFixed(1)} GHz · ${mem} GB · ${gpus}`
  })
</script>

<div class="view">
  <header>
    <h1>Live</h1>
    <p class="sub">1-second updates. {snapshot.latest ? `Last sample: ${fmtTime(snapshot.latest.ts)}` : 'waiting…'}</p>
    {#if sysText}
      <p class="sys" title={sysText}>{sysText}</p>
    {/if}
  </header>

  <div class="grid">
    <StatCard label="Total" value={fmtW(snapshot.latest?.totalW ?? 0)} tone="good" />
    <StatCard label="CPU" value={fmtW(snapshot.latest?.components.cpu ?? 0)} />
    <StatCard label="GPU" value={fmtW(snapshot.latest?.components.gpu ?? null)} />
    <StatCard label="RAM" value={fmtW(snapshot.latest?.components.ram ?? 0)} />
    <StatCard label="Disk" value={fmtW(snapshot.latest?.components.disk ?? 0)} />
    <StatCard label="Network" value={fmtW(snapshot.latest?.components.net ?? 0)} />
  </div>

  <div class="row">
    <LineChart
      title="Total system draw (last 2 min)"
      times={times}
      values={[totalSeries]}
      series={[{ label: 'Total', color: '#58a6ff' }]}
      yLabel="W"
    />
  </div>

  <div class="row">
    <LineChart
      title="Per-component draw"
      times={times}
      values={[cpuSeries, gpuSeries, ramSeries, diskSeries, netSeries]}
      series={[
        { label: 'CPU', color: '#f78166' },
        { label: 'GPU', color: '#a371f7' },
        { label: 'RAM', color: '#3fb950' },
        { label: 'Disk', color: '#d29922' },
        { label: 'Net', color: '#58a6ff' },
      ]}
      yLabel="W"
    />
  </div>

  <div class="leaderboard">
    <div class="title">Top apps right now</div>
    {#if topProcesses.length === 0}
      <div class="empty">No processes seen yet (samples take ~2s to prime).</div>
    {:else}
      <table>
        <thead>
          <tr>
            <th>App</th>
            <th class="num">CPU</th>
            <th class="num">GPU</th>
            <th class="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {#each topProcesses as p (p.pid)}
            <tr>
              <td class="name">{p.name || `pid ${p.pid}`}</td>
              <td class="num">{fmtW(p.cpuW)}</td>
              <td class="num">{fmtW(p.gpuW)}</td>
              <td class="num strong">{fmtW(p.w)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
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
  header h1 { margin: 0 0 4px; font-size: 22px; font-weight: 700; }
  header .sub { margin: 0; color: var(--fg-2); font-size: 13px; }
  header .sys {
    margin: 4px 0 0;
    color: var(--fg-1);
    font-size: 12px;
    font-family: var(--mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
  }
  .row { min-width: 0; }
  .leaderboard {
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    padding: 14px 16px;
  }
  .leaderboard .title { font-weight: 600; margin-bottom: 10px; color: var(--fg-1); }
  .empty { color: var(--fg-2); font-style: italic; padding: 12px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 13px;
  }
  th { color: var(--fg-2); font-weight: 500; font-size: 11px; text-transform: uppercase; }
  td.num, th.num { text-align: right; font-family: var(--mono); }
  td.strong { color: var(--fg-0); font-weight: 600; }
  td.name { font-family: var(--mono); color: var(--fg-1); }
  tbody tr:last-child td { border-bottom: none; }
</style>
