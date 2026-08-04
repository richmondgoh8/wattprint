<script lang="ts">
  type Period = '1h' | '6h' | '24h' | '7d' | '30d';
  type Props = { value: Period; onChange?: (p: Period) => void };
  let { value = $bindable('24h'), onChange }: Props = $props();

  const periods: { id: Period; label: string }[] = [
    { id: '1h', label: '1 H' },
    { id: '6h', label: '6 H' },
    { id: '24h', label: '24 H' },
    { id: '7d', label: '7 D' },
    { id: '30d', label: '30 D' },
  ];

  function pick(p: Period) {
    value = p;
    onChange?.(p);
  }
</script>

<div class="period">
  {#each periods as p (p.id)}
    <button class:active={value === p.id} onclick={() => pick(p.id)}>{p.label}</button>
  {/each}
</div>

<style>
  .period {
    display: inline-flex;
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    overflow: hidden;
  }
  button {
    background: transparent;
    border: none;
    color: var(--fg-1);
    padding: 4px 12px;
    font-size: 12px;
    font-family: var(--mono);
    border-radius: 0;
  }
  button:hover { background: var(--bg-2); color: var(--fg-0); }
  button.active { background: var(--accent); color: #0d1117; }
  button + button { border-left: 1px solid var(--border-subtle); }
</style>
