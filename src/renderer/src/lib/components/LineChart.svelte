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
  };

  let { title, series, times, values, height = 240, yLabel = '' }: Props = $props();

  let container: HTMLDivElement;
  let plot: uPlot | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let themeObserver: MutationObserver | null = null;

  /** Resolve uPlot chrome colors from the active CSS theme. */
  function chromeColors(): { fg: string; grid: string; tick: string } {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
    return { fg: v('--fg-2', '#68748a'), grid: v('--border', '#212a3a'), tick: v('--border-subtle', '#191f2b') };
  }

  function build() {
    if (!container) return;
    plot?.destroy();
    plot = null;
    container.innerHTML = '';
    const data: uPlot.AlignedData = [times, ...values] as uPlot.AlignedData;
    const { fg, grid, tick } = chromeColors();
    const opts: uPlot.Options = {
      width: container.clientWidth,
      height,
      padding: [10, 10, 0, 0],
      cursor: { drag: { x: true, y: false } },
      scales: { x: { time: true } },
      axes: [
        { stroke: fg, grid: { stroke: grid }, ticks: { stroke: tick } },
        { stroke: fg, grid: { stroke: grid }, ticks: { stroke: tick }, label: yLabel },
      ],
      series: [
        {},
        ...series.map((s, i): uPlot.Series => ({
          label: s.label,
          stroke: s.color,
          width: 2,
          fill: `${s.color}22`,
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
    // Rebuild when the theme attribute flips so axis colors follow.
    themeObserver = new MutationObserver(() => build());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  });

  onDestroy(() => {
    plot?.destroy();
    resizeObserver?.disconnect();
    themeObserver?.disconnect();
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
  <div class="chart" bind:this={container} style="height: {height}px" role="img" aria-label={title ? `${title} chart` : 'Chart'}></div>
</div>

<style>
  .wrap { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .title { color: var(--fg-1); font-size: 13px; font-weight: 600; }
  .chart {
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    padding: 8px;
    min-width: 0;
    animation: chart-in 240ms var(--ease-out);
  }
  @keyframes chart-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  @media (prefers-reduced-motion: reduce) { .chart { animation: none; } }
  :global(.u-legend) { color: var(--fg-1) !important; }
  :global(.u-legend .u-marker) { border-radius: 2px; }
</style>
