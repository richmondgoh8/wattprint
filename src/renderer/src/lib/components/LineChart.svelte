<script lang="ts">
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import { onMount, onDestroy } from 'svelte';

  type Series = { label: string; color: string };
  type Props = {
    title?: string;
    series: Series[];
    // parallel arrays: timestamps (seconds), then per-series numeric arrays
    times: number[];
    values: number[][];
    height?: number;
    yLabel?: string;
    fill?: boolean;
  };

  let { title, series, times, values, height = 240, yLabel = '', fill = true }: Props = $props();

  let container: HTMLDivElement;
  let plot: uPlot | null = null;
  let resizeObserver: ResizeObserver | null = null;

  function build() {
    if (!container) return;
    container.innerHTML = '';
    const data: uPlot.AlignedData = [times, ...values] as uPlot.AlignedData;
    const opts: uPlot.Options = {
      width: container.clientWidth,
      height,
      padding: [10, 10, 0, 0],
      cursor: { drag: { x: true, y: false } },
      scales: { x: { time: true } },
      axes: [
        { stroke: '#7d8590', grid: { stroke: '#21262d' }, ticks: { stroke: '#30363d' } },
        { stroke: '#7d8590', grid: { stroke: '#21262d' }, ticks: { stroke: '#30363d' }, label: yLabel },
      ],
      series: [
        {},
        ...series.map((s, i): uPlot.Series => ({
          label: s.label,
          stroke: s.color,
          width: 2,
          fill: fill ? `${s.color}22` : undefined,
          points: { show: false },
          value: (_u, v) => (v == null ? '—' : v.toFixed(2)),
        })),
      ],
    };
    plot = new uPlot(opts, data, container);
  }

  onMount(() => {
    build();
    resizeObserver = new ResizeObserver(() => {
      if (plot && container) {
        plot.setSize({ width: container.clientWidth, height });
      }
    });
    resizeObserver.observe(container);
  });

  onDestroy(() => {
    plot?.destroy();
    resizeObserver?.disconnect();
  });

  $effect(() => {
    // re-render when inputs change
    if (plot && times && values) {
      const data: uPlot.AlignedData = [times, ...values] as uPlot.AlignedData;
      plot.setData(data);
    }
  });
</script>

<div class="wrap">
  {#if title}<div class="title">{title}</div>{/if}
  <div class="chart" bind:this={container} style="height: {height}px"></div>
</div>

<style>
  .wrap { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .title { color: var(--fg-1); font-size: 13px; font-weight: 600; }
  .chart {
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    padding: 8px;
    min-width: 0;
  }
  :global(.u-legend) { color: var(--fg-1) !important; }
  :global(.u-legend .u-marker) { border-radius: 2px; }
</style>
