<script lang="ts">
  type Props = { label: string; value: string; sub?: string; tone?: 'default' | 'good' | 'warn' };
  let { label, value, sub, tone = 'default' }: Props = $props();
</script>

<div class="card" class:good={tone === 'good'} class:warn={tone === 'warn'}>
  <div class="label">{label}</div>
  <div class="value">{value}</div>
  {#if sub}<div class="sub">{sub}</div>{/if}
</div>

<style>
  .card {
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .label {
    color: var(--fg-2);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 500;
  }
  .value {
    font-family: var(--mono);
    font-size: 22px;
    font-weight: 600;
    color: var(--fg-0);
    line-height: 1.1;
  }
  .sub { color: var(--fg-2); font-size: 12px; }
  .good .value { color: var(--accent-2); }
  .warn .value { color: var(--warn); }
</style>
