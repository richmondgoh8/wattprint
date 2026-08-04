<script lang="ts">
  import { route, status, type Route } from '../stores.svelte.ts';

  const items: { id: Route; label: string; icon: string }[] = [
    { id: 'live', label: 'Live', icon: '⚡' },
    { id: 'hourly', label: 'Hourly Average', icon: '⏱' },
    { id: 'devices', label: 'All Devices', icon: '🖥' },
    { id: 'top', label: 'Top Consumers', icon: '🏆' },
    { id: 'forecast', label: 'Forecast', icon: '📈' },
    { id: 'settings', label: 'Settings', icon: '⚙' },
  ];
</script>

<aside class="sidebar">
  <div class="brand">
    <div class="logo">W</div>
    <div>
      <div class="name">Wattprint</div>
      <div class="tag">your energy footprint</div>
    </div>
  </div>

  <nav>
    {#each items as item (item.id)}
      <button
        class="nav-item"
        class:active={route.current === item.id}
        onclick={() => (route.current = item.id)}
      >
        <span class="icon">{item.icon}</span>
        <span>{item.label}</span>
      </button>
    {/each}
  </nav>

  <div class="status" title={status.message}>
    <span class="dot" class:err={status.message.startsWith('collect error') || status.message.startsWith('store error')}></span>
    <span class="msg">{status.message}</span>
  </div>
</aside>

<style>
  .sidebar {
    width: 220px;
    flex-shrink: 0;
    background: var(--bg-1);
    border-right: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    padding: 16px 12px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 24px;
    padding: 0 6px;
  }
  .logo {
    width: 36px;
    height: 36px;
    background: linear-gradient(135deg, var(--accent), #a371f7);
    border-radius: 8px;
    display: grid;
    place-items: center;
    font-weight: 800;
    color: #0d1117;
    font-size: 18px;
  }
  .name { font-weight: 700; }
  .tag { color: var(--fg-2); font-size: 11px; }

  nav { display: flex; flex-direction: column; gap: 2px; }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    color: var(--fg-1);
    padding: 8px 10px;
    border-radius: 6px;
  }
  .nav-item:hover { background: var(--bg-2); color: var(--fg-0); }
  .nav-item.active {
    background: var(--bg-2);
    color: var(--fg-0);
    border-color: var(--border);
  }
  .icon { font-size: 14px; opacity: 0.8; }

  .status {
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--bg-2);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    font-size: 11px;
    color: var(--fg-2);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-2);
    flex-shrink: 0;
  }
  .dot.err { background: var(--danger); }
  .msg { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
