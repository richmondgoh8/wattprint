<script lang="ts">
  import type { SourceKind } from '../wails';
  type Props = {
    label: string;
    value: string;
    sub?: string;
    tone?: 'default' | 'good' | 'warn';
    hint?: string;
    /** Provenance of the number: measured (real sensor), estimated (model), unavailable. */
    source?: SourceKind;
    /** Optional 0–100 fill for a slim coverage bar under the sub. */
    bar?: number;
    /** Accessible name for the coverage bar. */
    barLabel?: string;
  };
  let { label, value, sub, tone = 'default', hint, source, bar, barLabel }: Props = $props();
</script>

<div class="card" class:good={tone === 'good'} class:warn={tone === 'warn'} title={hint}>
  <div class="label">
    <span>{label}</span>
    {#if source === 'measured'}
      <span class="badge measured" title="Read from a real sensor (e.g. GPU ASIC power)">measured</span>
    {:else if source === 'estimated'}
      <span class="badge estimated" title="Computed from a model (see the accuracy panel below)">estimated</span>
    {:else if source === 'unavailable'}
      <span class="badge unavailable" title="No sensor or model output">n/a</span>
    {/if}
  </div>
  <div class="value">{value}</div>
  {#if sub}<div class="sub">{sub}</div>{/if}
  {#if bar != null}
    <div
      class="bar-track"
      role="img"
      aria-label={barLabel ?? `${label} coverage`}
      title={barLabel}
    >
      <div class="bar-fill" style="width: {Math.max(0, Math.min(100, bar))}%"></div>
    </div>
  {/if}
</div>

<style>
  .card {
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
    transition: border-color var(--dur-fast) ease, box-shadow var(--dur-fast) ease;
  }
  .card:hover {
    border-color: var(--border);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }
  .label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--fg-2);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
  }
  .badge {
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .badge.measured { background: var(--accent-soft); color: var(--accent); }
  .badge.estimated { background: var(--warn-soft); color: var(--warn); }
  .badge.unavailable { background: color-mix(in srgb, var(--fg-2) 16%, transparent); color: var(--fg-2); }
  .value {
    font-size: 24px;
    font-weight: 650;
    letter-spacing: -0.01em;
    color: var(--fg-0);
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub { color: var(--fg-2); font-size: 12px; }
  .bar-track {
    margin-top: 2px;
    height: 4px;
    border-radius: 999px;
    background: var(--bg-3);
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    border-radius: 999px;
    background: var(--accent);
    transition: width 240ms var(--ease-out);
  }
  .good .value { color: var(--accent-2); }
  .warn .value { color: var(--warn); }
</style>
