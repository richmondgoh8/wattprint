<script lang="ts">
  import { onMount } from 'svelte';
  import { snapshot, liveBuffer, settings } from '../lib/stores.svelte.ts';
  import StatCard from '../lib/components/StatCard.svelte';
  import LineChart from '../lib/components/LineChart.svelte';
  import { fmtW, fmtTime, fmtMoney, fmtBytes } from '../lib/format';
  import { nextSort, sortIndicator, ariaSort } from '../lib/sort';
  import { setSleepMode } from '../lib/wails';
  import type { Snapshot } from '../lib/wails';

  // Derive live time series from the rolling buffer.
  let times = $derived(liveBuffer.samples.map((s) => Math.floor(new Date(s.ts).getTime() / 1000)));
  let totalSeries = $derived(liveBuffer.samples.map((s) => s.totalW));
  let cpuSeries = $derived(liveBuffer.samples.map((s) => s.components.cpu ?? 0));
  let gpuSeries = $derived(liveBuffer.samples.map((s) => s.components.gpu ?? 0));
  let ramSeries = $derived(liveBuffer.samples.map((s) => s.components.ram ?? 0));
  let diskSeries = $derived(liveBuffer.samples.map((s) => s.components.disk ?? 0));
  let netSeries = $derived(liveBuffer.samples.map((s) => s.components.net ?? 0));

  // The process table refreshes at 2 Hz: re-rendering up to 1000 keyed rows
  // on every 1-second sample is needless DOM churn. The stat cards and charts
  // stay at full cadence.
  let tableProcesses = $state<Snapshot['processes']>([]);
  let tableTimer: ReturnType<typeof setInterval> | null = null;
  onMount(() => {
    tableProcesses = snapshot.latest?.processes ?? [];
    tableTimer = setInterval(() => {
      tableProcesses = snapshot.latest?.processes ?? [];
    }, 2000);
    return () => {
      if (tableTimer) clearInterval(tableTimer);
    };
  });

  let sortKey = $state<'name' | 'cpuW' | 'gpuW' | 'w' | 'cpuPct' | 'memoryBytes'>('w');
  let sortDir = $state<'asc' | 'desc'>('desc');
  let showAll = $state(false);
  const TABLE_CAP = 100;

  function toggleSort(key: 'name' | 'cpuW' | 'gpuW' | 'w' | 'cpuPct' | 'memoryBytes') {
    const next = nextSort(sortKey, sortDir, key, ['name']);
    sortKey = next.key;
    sortDir = next.dir;
  }

  function indicator(key: 'name' | 'cpuW' | 'gpuW' | 'w' | 'cpuPct' | 'memoryBytes'): string {
    return sortIndicator(key, sortKey, sortDir);
  }

  function tableAriaSort(key: 'name' | 'cpuW' | 'gpuW' | 'w' | 'cpuPct' | 'memoryBytes') {
    return ariaSort(key, sortKey, sortDir);
  }

  let sortedProcesses = $derived.by(() => {
    const list = [...tableProcesses];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
      return (a[sortKey] - b[sortKey]) * dir;
    });
    return list;
  });

  let displayProcesses = $derived(
    showAll ? sortedProcesses : sortedProcesses.slice(0, TABLE_CAP)
  );

  let memPct = $derived(
    (snapshot.latest?.memoryTotalBytes ?? 0) > 0
      ? `${Math.round(((snapshot.latest?.memoryUsedBytes ?? 0) / (snapshot.latest?.memoryTotalBytes ?? 1)) * 100)}% used`
      : undefined
  );

  let gpuSub = $derived.by(() => {
    const util = snapshot.latest?.gpuUtilPct;
    const power = snapshot.latest?.components.gpu;
    if (util == null && power == null) return undefined;
    const parts: string[] = [];
    if (util != null) parts.push(`${util.toFixed(0)}% utilization`);
    parts.push(power != null ? `${fmtW(power)} (measured)` : 'power unavailable');
    return parts.join(' · ');
  });

  let processCount = $derived(snapshot.latest?.processCount ?? 0);
  let gpuConsumers = $derived(snapshot.latest?.gpuConsumers ?? []);
  let gpuConsumersOpen = $state(false);
  let accuracyOpen = $state(false);

  let sources = $derived(snapshot.latest?.componentSources ?? {});
  let hasGpuW = $derived((snapshot.latest?.processes ?? []).some((p) => p.gpuW > 0));
  let appGpuW = $derived((snapshot.latest?.processes ?? []).reduce((sum, p) => sum + p.gpuW, 0));
  let sleepMode = $derived(snapshot.latest?.sleepMode);
  let sleepBusy = $state(false);
  let savedNowW = $derived(sleepMode?.baselineW ? Math.max(0, sleepMode.baselineW - (snapshot.latest?.totalW ?? 0)) : 0);

  async function toggleSleepMode() {
    if (!sleepMode || sleepBusy) return;
    sleepBusy = true;
    try {
      await setSleepMode(!sleepMode.active);
    } finally {
      sleepBusy = false;
    }
  }

  let costPerHour = $derived(
    settings.value != null
      ? fmtMoney((snapshot.latest?.totalW ?? 0) / 1000 * settings.value.costPerKWh, settings.value.currency, 3)
      : ''
  );
</script>

<div class="view">
  <header class="page-header">
    <div>
      <h1>Live</h1>
      <p class="sub">1-second updates · last sample {snapshot.latest ? fmtTime(snapshot.latest.ts) : 'waiting…'}</p>
    </div>
    {#if sleepMode?.supported}
      <button
        class="sleep-btn"
        class:active={sleepMode.active}
        disabled={sleepBusy}
        onclick={toggleSleepMode}
        title="Keep your music, throttle everything else. Whitelist apps in Settings."
      >
        {sleepMode.active ? 'Exit Sleep Mode' : 'Enter Sleep Mode'}
      </button>
    {/if}
  </header>

  {#if sleepMode?.active}
    <div class="sleep-banner" role="status">
      <span class="sleep-dot" aria-hidden="true"></span>
      <span>
        <strong>Sleep Mode</strong> · {sleepMode.throttledCount} processes throttled · currently
        {savedNowW > 0 ? `${fmtW(savedNowW)} below your idle baseline (${fmtW(sleepMode.baselineW)})` : 'measuring against your idle baseline'}
      </span>
    </div>
  {/if}

  <div class="grid">
    <StatCard label="Total" value={fmtW(snapshot.latest?.totalW ?? 0)} tone="good" hint="Estimated from TDP × utilization; not measured from sensors" sub={costPerHour ? `${costPerHour}/h` : undefined} />
    <StatCard label="CPU load" value={snapshot.latest?.cpuLoadPct != null ? `${snapshot.latest.cpuLoadPct.toFixed(0)}%` : '—'} hint="Total CPU usage; 100% = all cores" />
    <StatCard label="Memory" value={`${fmtBytes(snapshot.latest?.memoryUsedBytes ?? 0)} / ${fmtBytes(snapshot.latest?.memoryTotalBytes ?? 0)}`} sub={memPct} hint="OS memory in use — process sums exclude shared, cached, and kernel memory" />
    <StatCard label="CPU" value={fmtW(snapshot.latest?.components.cpu ?? 0)} source={sources.cpu} hint="Estimated: reference TDP × current CPU load" />
    <StatCard label="GPU" value={fmtW(snapshot.latest?.components.gpu ?? null)} sub={gpuSub} source={sources.gpu} hint="Power = measured ASIC power (LibreHardwareMonitor/ADL). Utilization = WDDM GPU engine sum, ~10s average (≈ Task Manager). Top consumer = largest WDDM GPU engine user. Neither metric is derived from the other." />
    <StatCard label="RAM" value={fmtW(snapshot.latest?.components.ram ?? 0)} source={sources.ram} hint="Estimated: ~3 W per 8 GB used" />
    <StatCard label="Disk" value={fmtW(snapshot.latest?.components.disk ?? 0)} source={sources.disk} hint="Estimated: idle + activity-based model" />
    <StatCard label="Network" value={fmtW(snapshot.latest?.components.net ?? 0)} source={sources.net} hint="Estimated: ~0.03 W per MB/s transferred (capped at 12 W)" />
  </div>

  <div class="row">
    <LineChart
      title="Total system draw (last 2 min)"
      times={times}
      values={[totalSeries]}
      series={[{ label: 'Total', color: '#5ba8f5' }]}
      yLabel="W"
    />
  </div>

  <div class="row">
    <LineChart
      title="Per-component draw"
      times={times}
      values={[cpuSeries, gpuSeries, ramSeries, diskSeries, netSeries]}
      series={[
        { label: 'CPU', color: '#f9736e' },
        { label: 'GPU', color: '#a78bfa' },
        { label: 'RAM', color: '#34d399' },
        { label: 'Disk', color: '#f5a623' },
        { label: 'Network', color: '#5ba8f5' },
      ]}
      yLabel="W"
    />
  </div>

  <div class="leaderboard">
    <div class="title">Live processes · {processCount}</div>
    {#if sortedProcesses.length === 0}
      <div class="empty">No processes seen yet (samples take ~2s to prime).</div>
    {:else}
      <div class="table-scroll">
        <table>
          <caption class="sr-only">Live process power consumption</caption>
          <thead>
            <tr>
              <th aria-sort={tableAriaSort('name')}><button class="sort-btn" class:active={sortKey === 'name'} onclick={() => toggleSort('name')}>App {indicator('name')}</button></th>
              <th class="num" aria-sort={tableAriaSort('cpuW')}><button class="sort-btn" class:active={sortKey === 'cpuW'} onclick={() => toggleSort('cpuW')}>CPU W {indicator('cpuW')}</button></th>
              {#if hasGpuW}
                <th class="num" aria-sort={tableAriaSort('gpuW')}><button class="sort-btn" class:active={sortKey === 'gpuW'} onclick={() => toggleSort('gpuW')}>GPU W {indicator('gpuW')}</button></th>
              {/if}
              <th class="num" aria-sort={tableAriaSort('w')}><button class="sort-btn" class:active={sortKey === 'w'} onclick={() => toggleSort('w')}>Total W {indicator('w')}</button></th>
              <th class="num" aria-sort={tableAriaSort('cpuPct')} title="Share of total CPU capacity (100% = all cores); derived from process CPU time, excludes kernel-only activity"><button class="sort-btn" class:active={sortKey === 'cpuPct'} onclick={() => toggleSort('cpuPct')}>CPU % {indicator('cpuPct')}</button></th>
              <th class="num" aria-sort={tableAriaSort('memoryBytes')} title="Private working set (Task Manager convention)"><button class="sort-btn" class:active={sortKey === 'memoryBytes'} onclick={() => toggleSort('memoryBytes')}>Memory {indicator('memoryBytes')}</button></th>
            </tr>
          </thead>
          <tbody>
            {#each displayProcesses as p (p.pid)}
              <tr>
                <td class="name">{p.name || `pid ${p.pid}`}</td>
                <td class="num">{fmtW(p.cpuW)}</td>
                {#if hasGpuW}
                  <td class="num">{fmtW(p.gpuW)}</td>
                {/if}
                <td class="num strong">{fmtW(p.w)}</td>
                <td class="num">{p.cpuPct.toFixed(1)}%</td>
                <td class="num">{fmtBytes(p.memoryBytes)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if sortedProcesses.length > TABLE_CAP}
        <div class="show-all-row">
          {#if showAll}
            <button class="show-all-btn" onclick={() => (showAll = false)}>Show top {TABLE_CAP} only</button>
          {:else}
            <button class="show-all-btn" onclick={() => (showAll = true)}>Show all {sortedProcesses.length} processes</button>
          {/if}
        </div>
      {/if}
    {/if}
  </div>

  {#if gpuConsumers.length}
    <div class="gpu-block">
      <button class="gpu-toggle" class:open={gpuConsumersOpen} onclick={() => (gpuConsumersOpen = !gpuConsumersOpen)} aria-expanded={gpuConsumersOpen}>
        <span class="gpu-toggle-title">GPU consumers · {gpuConsumers.length}{#if hasGpuW} · Σ {fmtW(appGpuW)} attributed{/if}</span>
        <span class="gpu-chevron" aria-hidden="true"></span>
      </button>
      {#if gpuConsumersOpen}
        <div class="gpu-list">
          {#each gpuConsumers as consumer (consumer.name)}
            <div class="gpu-row">
              <span class="gpu-name">{consumer.name}</span>
              <span class="gpu-pct">{consumer.pct.toFixed(0)}%</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <details class="accuracy" bind:open={accuracyOpen}>
    <summary>How accurate are these numbers?</summary>
    <div class="accuracy-body">
      <p>Every watt is either <span class="m">measured</span> by a real sensor or <span class="e">estimated</span> by a model. The badge on each card says which.</p>
      <ul>
        <li><strong>GPU</strong> — <em>measured</em>: ASIC power read from the driver (LibreHardwareMonitor / nvidia-smi / amd-smi). Typically within a few %.</li>
        <li><strong>CPU</strong> — <em>estimated</em>: reference TDP ({snapshot.latest?.cpuTdpW != null ? `${snapshot.latest.cpuTdpW} W` : 'unknown'}) × current load. Idle numbers are usually within ±20–30%.</li>
        <li><strong>RAM</strong> — <em>estimated</em>: ~3 W per 8 GB used.</li>
        <li><strong>Disk</strong> — <em>estimated</em>: 3 W idle + ~0.01 W per MB/s of activity (capped at 15 W).</li>
        <li><strong>Network</strong> — <em>estimated</em>: ~0.03 W per MB/s transferred (capped at 12 W).</li>
        <li><strong>Per-app watts</strong> — app shares are proportional to their CPU time (and GPU engine time), so an app's watts are approximate even when the component total is measured. GPU watts that no engine accounts for (idle GPU time) aren't assigned to any app.</li>
      </ul>
    </div>
  </details>
</div>

<style>
  header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  header h1 { margin: 0; font-size: 22px; font-weight: 700; }
  header .sub { margin: 0; color: var(--fg-2); font-size: 13px; }
  .sleep-btn {
    background: color-mix(in srgb, var(--accent-2) 12%, var(--bg-1));
    border: 1px solid color-mix(in srgb, var(--accent-2) 40%, var(--border));
    color: var(--accent-2);
    font-weight: 600;
    padding: 8px 16px;
    border-radius: 8px;
  }
  .sleep-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--accent-2) 20%, var(--bg-1)); }
  .sleep-btn.active {
    background: color-mix(in srgb, var(--warn) 14%, var(--bg-1));
    border-color: color-mix(in srgb, var(--warn) 45%, var(--border));
    color: var(--warn);
  }
  .sleep-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    border-radius: var(--radius);
    background: var(--warn-soft);
    border: 1px solid color-mix(in srgb, var(--warn) 30%, var(--border-subtle));
    color: var(--fg-1);
    font-size: 13px;
    animation: banner-in var(--dur-med) var(--ease-out);
  }
  @keyframes banner-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
  @media (prefers-reduced-motion: reduce) { .sleep-banner { animation: none; } }
  .sleep-banner strong { color: var(--warn); }
  .sleep-dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: var(--warn); animation: sleep-pulse 2s ease-in-out infinite; }
  @keyframes sleep-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  @media (prefers-reduced-motion: reduce) { .sleep-dot { animation: none; } }
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
  .table-scroll { max-height: 340px; overflow-y: auto; }
  .table-scroll thead th { position: sticky; top: 0; background: var(--bg-1); z-index: 1; }
  .empty { color: var(--fg-2); font-style: italic; padding: 12px 0; }
  .gpu-block {
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    padding: 10px 16px;
  }
  .gpu-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    background: none;
    border: none;
    padding: 4px 0;
    color: var(--fg-1);
    font: inherit;
    cursor: pointer;
  }
  .gpu-toggle-title { font-weight: 600; font-size: 13px; }
  .gpu-chevron {
    width: 7px;
    height: 7px;
    border-right: 1px solid var(--fg-2);
    border-bottom: 1px solid var(--fg-2);
    transform: rotate(45deg);
    transition: transform 180ms ease;
  }
  .gpu-toggle.open .gpu-chevron { transform: rotate(225deg) translate(1px, 1px); }
  .gpu-list { margin-top: 8px; max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  .gpu-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 5px 0;
    border-bottom: 1px solid var(--border-subtle);
  }
  .gpu-row:last-child { border-bottom: none; }
  .gpu-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-1); font-size: 12px; }
  .gpu-pct { color: var(--fg-0); font-family: var(--mono); font-size: 12px; }
  .accuracy {
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    padding: 10px 16px;
    color: var(--fg-2);
    font-size: 12px;
  }
  .accuracy summary { cursor: pointer; color: var(--fg-1); font-weight: 600; font-size: 13px; }
  .accuracy-body { margin-top: 10px; line-height: 1.6; }
  .accuracy-body p { margin: 0 0 8px; }
  .accuracy-body ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
  .accuracy-body strong { color: var(--fg-1); }
  .accuracy-body em { font-style: normal; color: var(--warn); }
  .m { color: var(--accent-2); font-weight: 600; }
  .e { color: var(--warn); font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th, td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 13px;
  }
  th { color: var(--fg-2); font-weight: 500; font-size: 11px; text-transform: uppercase; }
  .sort-btn { background: none; border: none; padding: 0; color: inherit; font: inherit; text-transform: inherit; letter-spacing: inherit; cursor: pointer; }
  .sort-btn.active { color: var(--fg-0); }
  th:not(.num) .sort-btn { text-align: left; }
  th.num .sort-btn { text-align: right; }
  td.num, th.num { text-align: right; font-family: var(--mono); }
  td.strong { color: var(--fg-0); font-weight: 600; }
  td.name { font-family: var(--mono); color: var(--fg-1); }
  tbody tr { transition: background var(--dur-fast) ease; }
  tbody tr:nth-child(even) { background: color-mix(in srgb, var(--bg-2) 25%, transparent); }
  tbody tr:hover { background: color-mix(in srgb, var(--bg-2) 55%, transparent); }
  tbody tr:last-child td { border-bottom: none; }
  .show-all-row { text-align: center; padding-top: 8px; }
  .show-all-btn {
    background: none;
    border: 1px solid var(--border-subtle);
    color: var(--fg-2);
    padding: 4px 12px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  }
  .show-all-btn:hover { color: var(--fg-0); border-color: var(--border); }
</style>
