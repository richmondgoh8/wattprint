<script lang="ts">
  import { route, status, type Route } from '../stores.svelte.ts';
  import Icon from './Icon.svelte';

  const items: { id: Route; label: string; icon: 'bolt' | 'calculator' | 'chip' | 'trophy' | 'chart' | 'gear' | 'cpu' }[] = [
    { id: 'live', label: 'Live', icon: 'bolt' },
    { id: 'calculator', label: 'Calculator', icon: 'calculator' },
    { id: 'info', label: 'Info', icon: 'cpu' },
    { id: 'top', label: 'Top Consumers', icon: 'trophy' },
    { id: 'forecast', label: 'Forecast', icon: 'chart' },
    { id: 'settings', label: 'Settings', icon: 'gear' },
  ];

  const isErr = $derived(status.message.startsWith('collect error') || status.message.startsWith('store error'));
</script>

<aside class="sidebar">
  <div class="brand">
    <div class="logo" aria-hidden="true"><Icon name="bolt" size={17} /></div>
    <div class="brand-copy">
      <div class="name">Wattprint</div>
      <div class="tag">your energy footprint</div>
    </div>
  </div>

  <div class="status status-mobile" title={status.message} aria-live="polite">
    <span class="dot" class:err={isErr}></span>
    <span class="msg">{status.message}</span>
  </div>

  <nav aria-label="Main navigation">
    {#each items as item (item.id)}
      <button
        class="nav-item"
        class:active={route.current === item.id}
        onclick={() => (route.current = item.id)}
        aria-current={route.current === item.id ? 'page' : undefined}
      >
        <span class="icon"><Icon name={item.icon} /></span>
        <span class="label">{item.label}</span>
      </button>
    {/each}
  </nav>

  <div class="status" title={status.message}>
    <span class="dot" class:err={isErr}></span>
    <span class="msg">{status.message}</span>
  </div>

  <div class="support">
    <a class="support-item" href="https://ko-fi.com/sinlucidious" target="_blank" rel="noreferrer" title="Buy me a coffee on Ko-fi">
      <span class="icon heart"><Icon name="heart" /></span>
      <span class="label">Sponsor</span>
    </a>
    <a class="support-item" href="https://github.com/richmondgoh8/wattprint" target="_blank" rel="noreferrer" title="Star Wattprint on GitHub">
      <span class="icon star"><Icon name="star" /></span>
      <span class="label">Star</span>
    </a>
  </div>
</aside>

<style>
  .sidebar {
    width: 212px;
    flex-shrink: 0;
    background: var(--bg-1);
    border-right: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    padding: 18px 12px 14px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 2px 6px 26px;
  }
  .logo {
    width: 32px;
    height: 32px;
    background: var(--accent-soft);
    color: var(--accent);
    border-radius: 9px;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
  }
  .brand-copy { min-width: 0; }
  .name { font-size: 14px; font-weight: 650; letter-spacing: -0.01em; }
  .tag { color: var(--fg-2); font-size: 10.5px; margin-top: 1px; }

  nav { display: flex; flex-direction: column; gap: 2px; }
  .nav-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    color: var(--fg-1);
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
    transition: background var(--dur-med) var(--ease-out), color var(--dur-med) var(--ease-out);
  }
  .nav-item:hover { background: var(--bg-2); color: var(--fg-0); }
  .nav-item.active {
    background: var(--accent-soft);
    color: var(--fg-0);
  }
  .nav-item.active::before {
    content: '';
    position: absolute;
    left: -12px;
    top: 9px;
    bottom: 9px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--accent);
  }
  .icon { display: inline-flex; align-items: center; justify-content: center; color: var(--fg-2); transition: color var(--dur-med) var(--ease-out); }
  .nav-item:hover .icon { color: var(--fg-0); }
  .nav-item.active .icon { color: var(--accent); }
  .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .support {
    display: flex;
    gap: 2px;
    padding: 6px 6px 2px;
    border-top: 1px solid var(--border-subtle);
    margin-top: 4px;
  }
  .support-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    color: var(--fg-2);
    font-size: 11px;
    font-weight: 500;
    text-decoration: none;
    transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
  }
  .support-item:hover { background: var(--bg-2); color: var(--fg-0); text-decoration: none; }
  .support-item .icon { display: inline-flex; }
  .support-item .icon.heart { color: var(--danger); }
  .support-item .icon.star { color: var(--warn); }

  .status {
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px 2px;
    font-size: 10.5px;
    color: var(--fg-2);
    font-family: var(--mono);
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex-shrink: 0; box-shadow: 0 0 0 3px var(--accent-soft); }
  .dot.err { background: var(--danger); box-shadow: 0 0 0 3px var(--danger-soft); }
  .msg { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status-mobile { display: none; }

  @media (max-width: 900px) {
    .sidebar { width: 68px; padding: 18px 8px 14px; }
    .brand { justify-content: center; margin-left: 0; margin-right: 0; }
    .brand-copy, .label { display: none; }
    .nav-item { justify-content: center; padding: 10px; }
    .nav-item.active::before { left: -8px; }
    .support { justify-content: center; flex-direction: column; align-items: center; padding: 4px 0 6px; }
    .status { justify-content: center; padding: 10px 0 2px; }
  }
  @media (max-width: 640px) {
    .sidebar { position: fixed; z-index: 20; inset: auto 0 0; width: 100%; height: 64px; flex-direction: row; align-items: center; padding: 7px 10px; border-top: 1px solid var(--border-subtle); border-right: 0; }
    .brand, .support { display: none; }
    .status:not(.status-mobile) { display: none; }
    .status-mobile { display: flex; position: absolute; bottom: 100%; left: 0; right: 0; padding: 4px 12px; font-size: 10px; border-top: 1px solid var(--border-subtle); background: var(--bg-1); }
    nav { width: 100%; flex-direction: row; justify-content: space-around; gap: 4px; }
    .nav-item { flex: 1; min-width: 0; }
    .nav-item.active::before { display: none; }
  }
</style>
