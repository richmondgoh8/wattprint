<script lang="ts">
  import StatCard from '../lib/components/StatCard.svelte';
  import { settings, route } from '../lib/stores.svelte.ts';
  import { fmtEnergy, fmtMoney } from '../lib/format';

  const STORAGE_KEY = 'wattprint.calculator';

  const presets: { label: string; watts: number }[] = [
    { label: 'Gaming PC', watts: 600 },
    { label: 'Desktop PC', watts: 400 },
    { label: 'Space heater', watts: 1500 },
    { label: 'Fridge', watts: 150 },
    { label: 'TV', watts: 100 },
    { label: 'Monitor', watts: 30 },
  ];

  let watts = $state(400);
  let hoursPerDay = $state(4);
  let daysPerWeek = $state(7);

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { watts?: number; hoursPerDay?: number; daysPerWeek?: number };
      if (typeof saved.watts === 'number' && saved.watts >= 0) watts = saved.watts;
      if (typeof saved.hoursPerDay === 'number' && saved.hoursPerDay >= 0) hoursPerDay = saved.hoursPerDay;
      if (typeof saved.daysPerWeek === 'number' && saved.daysPerWeek >= 0 && saved.daysPerWeek <= 7) daysPerWeek = saved.daysPerWeek;
    } catch {
      // corrupted storage — start fresh
    }
  }
  load();

  $effect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ watts, hoursPerDay, daysPerWeek }));
    } catch {
      // storage unavailable — persistence is best-effort
    }
  });

  let valid = $derived(Number.isFinite(watts) && watts > 0 && Number.isFinite(hoursPerDay) && hoursPerDay > 0 && Number.isFinite(daysPerWeek) && daysPerWeek > 0);

  let kwhPerDay = $derived(valid ? (watts * hoursPerDay) / 1000 : 0);
  let kwhPerMonth = $derived(valid ? kwhPerDay * (daysPerWeek * 30.4375) / 7 : 0);
  let kwhPerYear = $derived(valid ? kwhPerDay * daysPerWeek * 52.1429 : 0);
  let costPerDay = $derived(kwhPerDay * (settings.value?.costPerKWh ?? 0));
  let costPerMonth = $derived(kwhPerMonth * (settings.value?.costPerKWh ?? 0));
  let costPerYear = $derived(kwhPerYear * (settings.value?.costPerKWh ?? 0));

  let summary = $derived(
    valid
      ? `${watts.toLocaleString(undefined, { maximumFractionDigits: 0 })} W × ${hoursPerDay} h/day, ${daysPerWeek} day${daysPerWeek === 1 ? '' : 's'}/week ≈ ${fmtMoney(costPerMonth, settings.value?.currency ?? 'USD')}/month`
      : ''
  );
</script>

<div class="view">
  <header class="page-header">
    <div>
      <h1>Cost Calculator</h1>
      <p class="sub">What does any device cost to run? Enter watts and usage — cost uses your Settings rate.</p>
    </div>
  </header>

  <div class="panel">
    <label>
      <span>Power draw</span>
      <div class="row">
        <input type="number" min="0" step="1" bind:value={watts} />
        <span class="unit">W</span>
      </div>
    </label>

    <div class="presets" aria-label="Power draw presets">
      {#each presets as preset (preset.label)}
        <button type="button" class="chip" class:active={watts === preset.watts} onclick={() => (watts = preset.watts)}>
          {preset.label} <span class="chip-w">{preset.watts} W</span>
        </button>
      {/each}
    </div>

    <label>
      <span>Hours per day</span>
      <div class="row">
        <input type="number" min="0" step="0.5" bind:value={hoursPerDay} />
        <span class="unit">h</span>
      </div>
    </label>

    <label>
      <span>Days per week</span>
      <div class="row">
        <input type="number" min="0" max="7" step="1" bind:value={daysPerWeek} />
        <span class="unit">days</span>
      </div>
    </label>

    <p class="rate-note">
      Rate: <strong>{settings.value ? `${settings.value.costPerKWh.toFixed(3)} ${settings.value.currency}/kWh` : '…'}</strong>
      <button type="button" class="link-btn" onclick={() => (route.current = 'settings')}>change in Settings</button>
    </p>
  </div>

  <div class="grid">
    <StatCard label="Energy / day" value={fmtEnergy(kwhPerDay, 3)} />
    <StatCard label="Energy / month" value={fmtEnergy(kwhPerMonth)} />
    <StatCard label="Energy / year" value={fmtEnergy(kwhPerYear)} />
    <StatCard label="Cost / day" value={fmtMoney(costPerDay, settings.value?.currency ?? 'USD', 3)} />
    <StatCard label="Cost / month" value={fmtMoney(costPerMonth, settings.value?.currency ?? 'USD')} tone="good" />
    <StatCard label="Cost / year" value={fmtMoney(costPerYear, settings.value?.currency ?? 'USD')} />
  </div>

  {#if summary}
    <p class="summary">{summary}</p>
  {:else if !settings.value}
    <p class="summary">Loading rate…</p>
  {/if}

  <p class="footnote">Energy math: kWh/day = watts × hours ÷ 1000. Month = 30.44 days, year = 365.25 days. Totals are estimates — real usage always varies.</p>
</div>

<style>
  .view { max-width: 640px; }
  header h1 { margin: 0 0 4px; font-size: 22px; font-weight: 700; }
  header .sub { margin: 0; color: var(--fg-2); font-size: 13px; }
  .panel {
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  label { display: flex; flex-direction: column; gap: 6px; }
  label > span { color: var(--fg-1); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 500; }
  .row { display: flex; align-items: center; gap: 8px; }
  .unit { color: var(--fg-2); font-size: 12px; font-family: var(--mono); }
  .presets { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { display: inline-flex; align-items: baseline; gap: 5px; padding: 5px 12px; font-size: 12px; background: var(--bg-2); border: 1px solid var(--border-subtle); border-radius: 999px; color: var(--fg-1); transition: background var(--dur-fast) ease, border-color var(--dur-fast) ease, color var(--dur-fast) ease; }
  .chip:hover { background: var(--bg-3); }
  .chip.active { background: var(--accent-soft); border-color: var(--accent); color: var(--fg-0); }
  .chip-w { color: var(--fg-2); font-family: var(--mono); font-size: 11px; }
  .rate-note { margin: 0; color: var(--fg-2); font-size: 12px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .rate-note strong { color: var(--fg-1); font-family: var(--mono); }
  .link-btn { background: none; border: none; padding: 0; color: var(--accent); font-size: 12px; text-decoration: underline; }
  .link-btn:hover { filter: brightness(1.15); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
  .summary { margin: 0; color: var(--fg-1); font-size: 13px; line-height: 1.5; }
  .footnote { margin: 0; color: var(--fg-2); font-size: 11px; line-height: 1.5; }
</style>
