<script lang="ts">
  import { onDestroy } from 'svelte';
  import { resetLive, settings, systemInfo, applyTheme } from '../lib/stores.svelte.ts';
  import { getSettings, resetStatistics, updateSettings, type Settings } from '../lib/wails';
  import Icon from '../lib/components/Icon.svelte';

  let draft = $state<Settings | null>(null);
  let saved = $state(false);
  let error = $state<string | null>(null);
  let resetOpen = $state(false);
  let resetBusy = $state(false);
  let resetDone = $state(false);

  // Electron's setLoginItemSettings is a no-op on Linux, so the option would
  // silently do nothing there.
  let loginItemSupported = $derived(systemInfo.value?.os.platform !== 'linux');
  let modalEl = $state<HTMLDivElement | null>(null);
  let lastFocused: HTMLElement | null = null;
  let savedTimer: ReturnType<typeof setTimeout> | null = null;
  let resetTimer: ReturnType<typeof setTimeout> | null = null;
  let costError = $state<string | null>(null);
  let intervalError = $state<string | null>(null);

  function focusables(): HTMLElement[] {
    if (!modalEl) return [];
    return [...modalEl.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )];
  }

  function onModalKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (!resetBusy) resetOpen = false;
      return;
    }
    if (event.key !== 'Tab') return;
    const els = focusables();
    if (els.length === 0) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // Move focus into the dialog when it opens and restore it when it closes.
  $effect(() => {
    if (resetOpen && modalEl) {
      lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      focusables()[0]?.focus();
    } else if (!resetOpen && lastFocused) {
      lastFocused.focus();
      lastFocused = null;
    }
  });

  $effect(() => {
    if (settings.value && !draft) draft = { ...settings.value };
  });

  function applyDraftTheme() {
    if (draft) applyTheme(draft.theme);
  }

  function validateCost() {
    if (!draft) return;
    if (draft.costPerKWh < 0) costError = 'Cost cannot be negative';
    else costError = null;
  }

  function validateInterval() {
    if (!draft) return;
    const v = draft.sampleIntervalSeconds;
    if (!Number.isInteger(v) || v < 1 || v > 60) intervalError = 'Must be between 1 and 60 seconds';
    else intervalError = null;
  }

  onDestroy(() => {
    if (savedTimer) clearTimeout(savedTimer);
    if (resetTimer) clearTimeout(resetTimer);
  });

  async function save() {
    if (!draft) return;
    error = null;
    try {
      const savedSettings = await updateSettings({ ...draft });
      settings.value = { ...savedSettings };
      draft = { ...savedSettings };
      saved = true;
      if (savedTimer) clearTimeout(savedTimer);
      savedTimer = setTimeout(() => (saved = false), 2000);
    } catch (e) {
      error = String(e);
    }
  }

  async function reset() {
    resetBusy = true;
    error = null;
    try {
      await resetStatistics();
      resetLive();
      resetOpen = false;
      resetDone = true;
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => (resetDone = false), 2500);
    } catch (e) {
      error = String(e);
    } finally {
      resetBusy = false;
    }
  }
</script>

<div class="view">
  <header class="page-header">
    <h1>Settings</h1>
    <p class="sub">These values drive cost projections and data collection.</p>
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
      <section class="form-section">
        <h2 class="section-title">Cost &amp; appearance</h2>
        <label>
          <span>Electricity cost</span>
          <div class="row">
            <input
              type="number"
              step="0.001"
              min="0"
              bind:value={draft.costPerKWh}
              onblur={validateCost}
              oninput={() => (costError = null)}
            />
            <span class="unit">{draft.currency} / kWh</span>
          </div>
          {#if costError}<span class="field-error" role="alert">{costError}</span>{/if}
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
          <span>Appearance</span>
          <select bind:value={draft.theme} onchange={applyDraftTheme}>
            <option value="system">System default</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </section>

      <section class="form-section">
        <h2 class="section-title">Monitoring</h2>
        <label>
          <span>Sample interval</span>
          <select bind:value={draft.sampleIntervalSeconds} onchange={validateInterval}>
            <option value={1}>1 second</option>
            <option value={2}>2 seconds</option>
            <option value={5}>5 seconds</option>
            <option value={10}>10 seconds</option>
          </select>
          {#if intervalError}<span class="field-error" role="alert">{intervalError}</span>{/if}
        </label>

        {#if loginItemSupported}
          <label class="check">
            <input type="checkbox" bind:checked={draft.startOnLogin} />
            <span>Start Wattprint on login</span>
          </label>
        {:else}
          <p class="retention-note">"Start on login" isn't available on Linux (Electron doesn't support autostart entries there).</p>
        {/if}

        <label class="check">
          <input type="checkbox" bind:checked={draft.closeToTray} />
          <span>Close to system tray</span>
        </label>
      </section>

      <section class="form-section">
        <h2 class="section-title">Sleep Mode</h2>
        <p class="alerts-empty">One click in the Live view or tray keeps music apps running while throttling everything else (Task Manager's Efficiency Mode mechanism). Apps listed here keep full speed.</p>
        <label>
          <span>Whitelist (comma-separated app names)</span>
          <input
            type="text"
            value={(draft.sleepMode?.whitelist ?? []).join(', ')}
            placeholder="spotify, spotify web helper, chrome"
            oninput={(e) => {
              if (!draft) return;
              draft = {
                ...draft,
                sleepMode: {
                  whitelist: e.currentTarget.value
                    .split(',')
                    .map((w) => w.trim().toLowerCase())
                    .filter((w) => w.length > 0),
                },
              };
            }}
          />
        </label>
      </section>

      <div class="actions">
        <button type="submit" class="primary" disabled={!draft}>Save</button>
        {#if saved}<span class="saved">Saved ✓</span>{/if}
        {#if error}<span class="error">{error}</span>{/if}
      </div>
    </form>

      <section class="form-section">
        <h2 class="section-title">Support &amp; project</h2>
        <p class="alerts-empty">Wattprint is free and open source — if it saves you money, consider supporting it.</p>
        <div class="support-actions">
          <a class="btn primary" href="https://ko-fi.com/sinlucidious" target="_blank" rel="noreferrer">
            <Icon name="heart" size={14} /> Buy me a coffee
          </a>
          <a class="btn" href="https://github.com/richmondgoh8/wattprint" target="_blank" rel="noreferrer">
            <Icon name="star" size={14} /> Star on GitHub
          </a>
        </div>
      </section>

      <section class="form-section">
        <h2 class="section-title">Data</h2>
      <div class="danger-zone" aria-labelledby="reset-title">
        <div>
          <h2 id="reset-title">Reset statistics</h2>
          <p>Delete collected samples, hourly history, and machine-state ledger. Your settings will stay unchanged.</p>
        </div>
        <button class="danger" type="button" onclick={() => (resetOpen = true)}>Reset statistics</button>
        {#if resetDone}<span class="reset-done">Statistics reset</span>{/if}
      </div>
      <p class="retention-note">Raw samples are kept for 48 hours to power recent views; aggregated hourly history is retained indefinitely. To lower overhead further, adjust the sample interval above.</p>
      <p class="retention-note">NVIDIA GPU power readings work automatically via nvidia-smi. On AMD GPUs, install <code>amd-smi</code> (AMD SMI) to enable real power readings.</p>
    </section>
  {/if}
</div>

{#if resetOpen}
  <div class="modal-backdrop" role="presentation" onclick={() => !resetBusy && (resetOpen = false)}>
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-reset-title"
      tabindex="-1"
      bind:this={modalEl}
      onclick={(event) => event.stopPropagation()}
      onkeydown={onModalKeydown}
    >
      <h2 id="confirm-reset-title">Reset all statistics?</h2>
      <p>This permanently deletes your samples and hourly history. It does not change your settings.</p>
      <div class="modal-actions">
        <button type="button" onclick={() => (resetOpen = false)} disabled={resetBusy}>Cancel</button>
        <button type="button" class="danger" onclick={reset} disabled={resetBusy}>{resetBusy ? 'Resetting…' : 'Reset statistics'}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .view { max-width: 720px; }
  header h1 { margin: 0 0 4px; font-size: 22px; font-weight: 700; }
  header .sub { margin: 0 0 20px; color: var(--fg-2); font-size: 13px; }
  .form { display: flex; flex-direction: column; gap: 20px; }
  .form-section {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px 18px;
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
  }
  .section-title { margin: 0; color: var(--fg-2); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; }
  label { display: flex; flex-direction: column; gap: 6px; }
  label > span { color: var(--fg-1); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 500; }
  .row { display: flex; align-items: center; gap: 8px; }
  .unit { color: var(--fg-2); font-size: 12px; font-family: var(--mono); }
  .check { flex-direction: row; align-items: center; gap: 8px; }
  .check > span { text-transform: none; letter-spacing: 0; font-size: 13px; color: var(--fg-1); }
  .actions { display: flex; align-items: center; gap: 12px; }
  .saved { color: var(--accent-2); font-size: 13px; }
  .error { color: var(--danger); font-size: 13px; }
  .field-error { color: var(--danger); font-size: 11px; margin-top: 4px; }
  .empty { color: var(--fg-2); padding: 24px 0; text-align: center; }
  .danger-zone { margin-top: 2px; padding: 14px 16px; border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--border)); border-radius: var(--radius); background: var(--danger-soft); }
  .danger-zone h2 { margin: 0; font-size: 14px; }
  .danger-zone p { margin: 4px 0 12px; color: var(--fg-2); font-size: 12px; }
  .retention-note { margin: 12px 0 0; color: var(--fg-2); font-size: 11px; line-height: 1.5; }
  .reset-done { display: block; margin-top: 10px; color: var(--accent-2); font-size: 12px; }
  .alerts-empty { margin: 0; color: var(--fg-2); font-size: 12px; line-height: 1.5; }
  .support-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--fg-0);
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    transition: background var(--dur-fast) ease, border-color var(--dur-fast) ease;
  }
  .btn:hover { background: var(--bg-3); text-decoration: none; }
  .btn.primary { background: var(--accent); color: var(--accent-fg); border-color: transparent; font-weight: 600; }
  .btn.primary:hover { background: color-mix(in srgb, var(--accent) 88%, white); }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    background: rgba(5, 8, 13, 0.5);
    backdrop-filter: blur(3px);
    animation: fade-in var(--dur-fast) ease;
  }
  .modal {
    width: min(420px, 100%);
    margin: 0 24px;
    padding: 22px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-2);
    animation: modal-in 220ms var(--ease-out);
  }
  .modal h2 { margin: 0 0 6px; font-size: 18px; letter-spacing: -0.01em; }
  .modal p { margin: 0; color: var(--fg-2); font-size: 13px; line-height: 1.5; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
  @keyframes modal-in { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .modal, .modal-backdrop { animation: none; } }
</style>
