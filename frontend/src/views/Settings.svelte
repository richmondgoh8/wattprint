<script lang="ts">
  import { settings } from '../lib/stores.svelte.ts';
  import { getSettings, updateSettings, type Settings } from '../lib/wails';

  let draft = $state<Settings | null>(null);
  let saved = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    if (settings.value && !draft) draft = { ...settings.value };
  });

  async function save() {
    if (!draft) return;
    error = null;
    try {
      await updateSettings(draft);
      settings.value = { ...draft };
      saved = true;
      setTimeout(() => (saved = false), 2000);
    } catch (e) {
      error = String(e);
    }
  }
</script>

<div class="view">
  <header>
    <h1>Settings</h1>
    <p class="sub">These values drive cost & CO₂ projections everywhere.</p>
  </header>

  {#if !draft}
    <div class="empty">Loading…</div>
  {:else}
    <form
      class="form"
      onsubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label>
        <span>Electricity cost</span>
        <div class="row">
          <input
            type="number"
            step="0.001"
            min="0"
            bind:value={draft.costPerKWh}
          />
          <span class="unit">{draft.currency} / kWh</span>
        </div>
      </label>

      <label>
        <span>Currency</span>
        <select bind:value={draft.currency}>
          <option value="USD">USD — US Dollar</option>
          <option value="EUR">EUR — Euro</option>
          <option value="GBP">GBP — Pound</option>
          <option value="MYR">MYR — Ringgit</option>
          <option value="SGD">SGD — Singapore Dollar</option>
          <option value="JPY">JPY — Yen</option>
          <option value="CNY">CNY — Yuan</option>
          <option value="INR">INR — Rupee</option>
          <option value="AUD">AUD — Australian Dollar</option>
          <option value="CAD">CAD — Canadian Dollar</option>
        </select>
      </label>

      <label>
        <span>Grid carbon intensity</span>
        <div class="row">
          <input
            type="number"
            step="1"
            min="0"
            bind:value={draft.gridCarbonIntensity}
          />
          <span class="unit">g CO₂ / kWh</span>
        </div>
        <div class="hint">Common: USA 384 · EU 230 · France 42 · Malaysia 631 · China 555</div>
      </label>

      <label>
        <span>Forecast window</span>
        <select bind:value={draft.forecastWindowDays}>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
        </select>
      </label>

      <label>
        <span>Sample interval</span>
        <select bind:value={draft.sampleIntervalSeconds}>
          <option value={1}>1 second</option>
          <option value={2}>2 seconds</option>
          <option value={5}>5 seconds</option>
          <option value={10}>10 seconds</option>
        </select>
      </label>

      <label class="check">
        <input type="checkbox" bind:checked={draft.startOnLogin} />
        <span>Start Wattprint on login (planned for v0.2)</span>
      </label>

      <div class="actions">
        <button type="submit" class="primary" disabled={!draft}>Save</button>
        {#if saved}<span class="saved">Saved ✓</span>{/if}
        {#if error}<span class="error">{error}</span>{/if}
      </div>
    </form>
  {/if}
</div>

<style>
  .view { padding: 24px 28px; overflow-y: auto; max-width: 600px; }
  header h1 { margin: 0 0 4px; font-size: 22px; font-weight: 700; }
  header .sub { margin: 0 0 20px; color: var(--fg-2); font-size: 13px; }
  .form { display: flex; flex-direction: column; gap: 16px; }
  label { display: flex; flex-direction: column; gap: 6px; }
  label > span { color: var(--fg-1); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 500; }
  .row { display: flex; align-items: center; gap: 8px; }
  .unit { color: var(--fg-2); font-size: 12px; font-family: var(--mono); }
  .hint { color: var(--fg-2); font-size: 11px; margin-top: 2px; }
  .check { flex-direction: row; align-items: center; gap: 8px; }
  .check > span { text-transform: none; letter-spacing: 0; font-size: 13px; color: var(--fg-1); }
  .actions { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
  .saved { color: var(--accent-2); font-size: 13px; }
  .error { color: var(--danger); font-size: 13px; }
  .empty { color: var(--fg-2); padding: 24px 0; text-align: center; }
</style>
