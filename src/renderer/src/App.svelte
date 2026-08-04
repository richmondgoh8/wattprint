<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import Live from './views/Live.svelte';
  import HourlyAverage from './views/HourlyAverage.svelte';
  import AllDevices from './views/AllDevices.svelte';
  import TopConsumers from './views/TopConsumers.svelte';
  import Forecast from './views/Forecast.svelte';
  import Settings from './views/Settings.svelte';
  import { route, pushSample, status, settings } from './lib/stores.svelte.ts';
  import { start, getSettings, onSample, onStatus } from './lib/wails';

  let unsubSample: (() => void) | null = null;
  let unsubStatus: (() => void) | null = null;

  onMount(async () => {
    // Load settings, subscribe to events, then start the collector.
    try {
      settings.value = await getSettings();
    } catch (e) {
      status.message = 'failed to load settings';
    }
    unsubSample = onSample((s) => pushSample(s));
    unsubStatus = onStatus((s) => (status.message = s));
    try {
      await start();
    } catch (e) {
      status.message = 'failed to start: ' + String(e);
    }
  });

  onDestroy(() => {
    unsubSample?.();
    unsubStatus?.();
  });
</script>

<Sidebar />

<main>
  {#if route.current === 'live'}
    <Live />
  {:else if route.current === 'hourly'}
    <HourlyAverage />
  {:else if route.current === 'devices'}
    <AllDevices />
  {:else if route.current === 'top'}
    <TopConsumers />
  {:else if route.current === 'forecast'}
    <Forecast />
  {:else if route.current === 'settings'}
    <Settings />
  {/if}
</main>

<style>
  main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
