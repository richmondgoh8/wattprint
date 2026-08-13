<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import { quadOut } from 'svelte/easing';
  import Sidebar from './lib/components/Sidebar.svelte';
  import ReadinessBanner from './lib/components/ReadinessBanner.svelte';
  import Live from './views/Live.svelte';
  import Calculator from './views/Calculator.svelte';
  import Info from './views/Info.svelte';
  import TopConsumers from './views/TopConsumers.svelte';
  import Forecast from './views/Forecast.svelte';
  import Settings from './views/Settings.svelte';
  import { route, pushSample, readiness, status, settings, systemInfo, applyTheme, setBufferSeconds, type Route } from './lib/stores.svelte.ts';
  import { getReadiness, getSettings, getSystemInfo, onSample, onStatus, start } from './lib/wails';

  let unsubSample: (() => void) | null = null;
  let unsubStatus: (() => void) | null = null;
  let readinessTimer: ReturnType<typeof setInterval> | null = null;

  async function refreshReadiness() {
    try {
      const r = await getReadiness();
      readiness.value = r;
      // Do not overwrite status.message: transient collector/store/sample
      // errors arriving via onStatus must stay visible until replaced.
    } catch {
      // The banner remains in its starting state until the backend is ready.
    }
  }

  onMount(async () => {
    // Subscribe and start the collector first so live data flows immediately;
    // system info loads in parallel and is non-fatal.
    unsubSample = onSample((s) => pushSample(s));
    unsubStatus = onStatus((s) => (status.message = s));
    try {
      settings.value = await getSettings();
      applyTheme(settings.value.theme);
      setBufferSeconds(settings.value.sampleIntervalSeconds);
      await start();
      await refreshReadiness();
      readinessTimer = setInterval(refreshReadiness, 5000);
    } catch (e) {
      status.message = 'failed to start: ' + String(e);
    }
    getSystemInfo()
      .then((info) => (systemInfo.value = info))
      .catch(() => {
        // Non-fatal: hardware details just stay unavailable.
      });
  });

  onDestroy(() => {
    unsubSample?.();
    unsubStatus?.();
    if (readinessTimer) clearInterval(readinessTimer);
  });
</script>

<Sidebar />

<main>
  <div class="topbar">
    <div class="topbar-brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <span>Wattprint</span>
    </div>
    <ReadinessBanner />
  </div>
  <div class="route-content">
    {#key route.current}
      <svelte:boundary>
        <div class="route-page" in:fade={{ duration: 140, easing: quadOut }}>
          {#if route.current === 'live'}
            <Live />
          {:else if route.current === 'calculator'}
            <Calculator />
          {:else if route.current === 'info'}
            <Info />
          {:else if route.current === 'top'}
            <TopConsumers />
          {:else if route.current === 'forecast'}
            <Forecast />
          {:else if route.current === 'settings'}
            <Settings />
          {/if}
        </div>
        {#snippet failed(_error, reset)}
          <div class="route-error" role="alert">
            <p>Something went wrong loading this view.</p>
            <button type="button" onclick={reset}>Try again</button>
          </div>
        {/snippet}
      </svelte:boundary>
    {/key}
  </div>
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
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 28px;
    border-bottom: 1px solid var(--border-subtle);
    background: color-mix(in srgb, var(--bg-1) 72%, var(--bg-0));
    flex: 0 0 auto;
  }
  .topbar-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--fg-2);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .brand-mark {
    width: 9px;
    height: 9px;
    border-radius: 3px;
    background: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .route-content { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .route-page { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .route-error { padding: 24px; text-align: center; color: var(--fg-2); }
  .route-error p { margin: 0 0 12px; }
  .route-error button { background: var(--bg-2); border: 1px solid var(--border); color: var(--fg-0); padding: 6px 16px; border-radius: 6px; }
  @media (max-width: 640px) { .topbar { padding: 8px 16px; } }
</style>
