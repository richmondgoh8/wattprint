<script lang="ts">
  import { onMount } from 'svelte';
  import { readiness } from '../stores.svelte.ts';

  let now = $state(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    timer = setInterval(() => (now = Date.now()), 1000);
    return () => {
      if (timer) clearInterval(timer);
    };
  });

  let data = $derived(readiness.value);
  let message = $derived.by(() => {
    if (!data) return 'Starting data collection…';
    if (!data.processSamplesAvailable) return 'Collecting process data…';
    if (data.hourlyBucketsAvailable === 0) return `First hourly metrics in ${countdown(data.nextHourlyDataAt, now)}`;
    if (data.hourlyBucketsAvailable < data.forecastBucketsRequired) {
      return `Forecast confidence ${data.hourlyBucketsAvailable}/${data.forecastBucketsRequired} h · ${countdown(data.nextHourlyDataAt, now)} to next bucket`;
    }
    return `Updated ${relative(data.lastSampleAt, now)}`;
  });

  function countdown(iso: string, timestamp: number): string {
    const seconds = Math.max(0, Math.ceil((new Date(iso).getTime() - timestamp) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  function relative(iso: string | null, timestamp: number): string {
    if (!iso) return 'waiting';
    const seconds = Math.max(0, Math.floor((timestamp - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.floor(seconds / 60)}m ago`;
  }
</script>

<div class="chip" role="status" aria-live="polite">
  <span class:ready={!!data?.processSamplesAvailable} class="dot"></span>
  <span class="msg">{message}</span>
</div>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 4px 10px;
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    background: var(--bg-1);
    color: var(--fg-2);
    font-family: var(--mono);
    font-size: 10px;
    white-space: nowrap;
    max-width: 100%;
  }
  .dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: var(--warn); }
  .dot.ready { background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .msg { overflow: hidden; text-overflow: ellipsis; }
</style>
