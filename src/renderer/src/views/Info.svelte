<script lang="ts">
  import Icon from '../lib/components/Icon.svelte';
  import { snapshot, systemInfo } from '../lib/stores.svelte.ts';
  import { fmtBytes } from '../lib/format';
  import { nextSort, sortIndicator, ariaSort } from '../lib/sort';

  type Section = 'cpu' | 'gpu' | 'memory' | 'storage' | 'network' | 'motherboard' | 'system';
  type SectionItem = { id: Section; label: string; icon: 'cpu' | 'chip'; summary: string };

  let info = $derived(systemInfo.value);
  let cpu = $derived(info?.cpu ?? null);
  let memory = $derived(info?.memory ?? null);
  let gpus = $derived(info?.gpus ?? []);
  let disks = $derived(info?.disks ?? []);
  let networks = $derived(info?.networks ?? []);
  let gpuConsumers = $derived(snapshot.latest?.gpuConsumers ?? []);
  let motherboard = $derived(info?.motherboard ?? null);
  let bios = $derived(info?.bios ?? null);
  let os = $derived(info?.os ?? null);
  let selected = $state<Section>('cpu');

  let sections = $derived<SectionItem[]>([
    { id: 'cpu', label: 'Processor', icon: 'cpu', summary: cpu?.brand ?? 'Unavailable' },
    { id: 'gpu', label: 'Graphics', icon: 'chip', summary: gpus[0]?.model ?? 'Not detected' },
    { id: 'memory', label: 'Memory', icon: 'chip', summary: memory ? fmtBytes(memory.totalBytes) : 'Unavailable' },
    { id: 'storage', label: 'Storage', icon: 'chip', summary: `${disks.length} drive${disks.length === 1 ? '' : 's'}` },
    { id: 'network', label: 'Network', icon: 'chip', summary: `${networks.length} adapter${networks.length === 1 ? '' : 's'}` },
    { id: 'motherboard', label: 'Motherboard', icon: 'chip', summary: motherboard?.model ?? 'Unavailable' },
    { id: 'system', label: 'System', icon: 'cpu', summary: os?.distro ?? 'Unavailable' }
  ]);

  let selectedSection = $derived(sections.find((section) => section.id === selected) ?? sections[0]);

  let memSortKey = $state<'bank' | 'sizeBytes' | 'type' | 'clockMHz' | 'manufacturer'>('bank');
  let memSortDir = $state<'asc' | 'desc'>('asc');

  function toggleMemSort(key: 'bank' | 'sizeBytes' | 'type' | 'clockMHz' | 'manufacturer') {
    const next = nextSort(memSortKey, memSortDir, key, ['bank', 'type', 'manufacturer']);
    memSortKey = next.key;
    memSortDir = next.dir;
  }

  function memIndicator(key: 'bank' | 'sizeBytes' | 'type' | 'clockMHz' | 'manufacturer'): string {
    return sortIndicator(key, memSortKey, memSortDir);
  }

  function memAriaSort(key: 'bank' | 'sizeBytes' | 'type' | 'clockMHz' | 'manufacturer') {
    return ariaSort(key, memSortKey, memSortDir);
  }

  let memModules = $derived.by(() => {
    const list = [...(memory?.modules ?? [])];
    const dir = memSortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (memSortKey === 'sizeBytes') return (a.sizeBytes - b.sizeBytes) * dir;
      if (memSortKey === 'clockMHz') return ((a.clockMHz ?? -1) - (b.clockMHz ?? -1)) * dir;
      return String(a[memSortKey]).localeCompare(String(b[memSortKey])) * dir;
    });
    return list;
  });

  function value(numberValue: number | null | undefined, suffix = ''): string {
    return numberValue == null || !Number.isFinite(numberValue) ? '—' : `${numberValue}${suffix}`;
  }
</script>

<div class="view">
  <header class="page-header">
    <div>
      <div class="eyebrow"><span class="pulse"></span> Hardware inventory <span class="source">{info?.diagnostics.runtime ?? 'Detecting runtime'}</span></div>
      <h1>System overview</h1>
      <p class="sub">A focused view of the hardware Wattprint can see.</p>
    </div>
    <div class="scan-state"><span class:ready={!!info}></span>{info ? 'Inventory ready' : 'Scanning hardware'}</div>
  </header>

  <section class="overview" aria-label="Hardware summary">
    <button class="overview-card accent-blue" class:active={selected === 'cpu'} onclick={() => (selected = 'cpu')}>
      <span class="card-top"><span class="icon-badge"><Icon name="cpu" /></span><span>CPU</span></span>
      <strong>{cpu?.brand ?? 'Unavailable'}</strong>
      <small>{cpu ? `${cpu.physicalCores} cores · ${cpu.cores} threads` : 'Waiting for hardware data'}</small>
    </button>
    <button class="overview-card accent-purple" class:active={selected === 'gpu'} onclick={() => (selected = 'gpu')}>
      <span class="card-top"><span class="icon-badge"><Icon name="chip" /></span><span>GPU</span></span>
      <strong>{gpus[0]?.model ?? 'Not detected'}</strong>
      <small>{gpus.length ? gpus[0].vendor : 'Host adapter unavailable'}</small>
    </button>
    <button class="overview-card accent-green" class:active={selected === 'memory'} onclick={() => (selected = 'memory')}>
      <span class="card-top"><span class="icon-badge"><Icon name="chip" /></span><span>Memory</span></span>
      <strong>{memory ? fmtBytes(memory.totalBytes) : 'Unavailable'}</strong>
      <small>{memory ? `${memory.modules.length} configured slots` : 'Waiting for hardware data'}</small>
    </button>
    <button class="overview-card accent-orange" class:active={selected === 'storage'} onclick={() => (selected = 'storage')}>
      <span class="card-top"><span class="icon-badge"><Icon name="chip" /></span><span>Storage</span></span>
      <strong>{disks.length} drive{disks.length === 1 ? '' : 's'}</strong>
      <small>{disks.length ? fmtBytes(disks.reduce((sum, disk) => sum + disk.sizeBytes, 0)) + ' total' : 'No drive inventory'}</small>
    </button>
    <button class="overview-card accent-blue" class:active={selected === 'motherboard'} onclick={() => (selected = 'motherboard')}>
      <span class="card-top"><span class="icon-badge"><Icon name="chip" /></span><span>Motherboard</span></span>
      <strong>{motherboard?.model ?? 'Unavailable'}</strong>
      <small>{motherboard?.chipset !== '—' ? motherboard?.chipset : motherboard?.manufacturer}</small>
    </button>
    <button class="overview-card accent-green" class:active={selected === 'system'} onclick={() => (selected = 'system')}>
      <span class="card-top"><span class="icon-badge"><Icon name="cpu" /></span><span>System</span></span>
      <strong>{os?.distro ?? 'Unavailable'}</strong>
      <small>{os?.build != null && os.build !== '—' ? `Build ${os.build}` : os?.arch}</small>
    </button>
  </section>

  <section class="hardware-workspace" aria-label="Hardware details">
    <nav class="hardware-nav" aria-label="Hardware categories">
      <div class="nav-heading">Components</div>
      {#each sections as section (section.id)}
        <button class:active={selected === section.id} class="hardware-nav-item" onclick={() => (selected = section.id)} aria-current={selected === section.id ? 'page' : undefined}>
          <span class="nav-icon"><Icon name={section.icon} /></span>
          <span class="nav-copy"><strong>{section.label}</strong><small>{section.summary}</small></span>
          <span class="nav-arrow" aria-hidden="true"></span>
        </button>
      {/each}
      <div class="nav-footer">Source<br /><strong>{info?.diagnostics.gpuSource ?? 'Local hardware probe'}</strong></div>
    </nav>

    <section class="detail-panel" aria-labelledby="detail-title">
      <header class="detail-header">
        <div>
          <div class="eyebrow">Component details</div>
          <h2 id="detail-title">{selectedSection?.label}</h2>
        </div>
        <span class="status-pill"><span></span>{info ? 'Available' : 'Loading'}</span>
      </header>

      {#key selected}
        <div class="detail-content">
          {#if selected === 'cpu'}
            <div class="hero-value">{cpu?.brand ?? 'CPU data unavailable'}</div>
            <dl class="spec-grid">
              <div><dt>Model</dt><dd>{cpu?.brand ?? '—'}</dd></div>
              <div><dt>Codename</dt><dd>{cpu?.codename ?? '—'}</dd></div>
              <div><dt>TDP (reference)</dt><dd>{value(cpu?.tdpW, ' W')}</dd></div>
              <div><dt>Cores / threads</dt><dd>{cpu ? `${cpu.physicalCores} / ${cpu.cores}` : '—'}</dd></div>
              <div><dt>Current speed</dt><dd>{value(cpu?.speedGHz, ' GHz')}</dd></div>
              <div><dt>Socket</dt><dd>{cpu?.socket ?? '—'}</dd></div>
              <div><dt>L2 / L3 cache</dt><dd>{cpu ? `${fmtBytes(cpu.cache.l2Bytes)} / ${fmtBytes(cpu.cache.l3Bytes)}` : '—'}</dd></div>
              <div><dt>Virtualization</dt><dd>{cpu?.virtualization == null ? '—' : cpu.virtualization ? 'Enabled' : 'Disabled'}</dd></div>
            </dl>
          {:else if selected === 'gpu'}
            {#if gpus.length}
              <div class="device-list">
                {#each gpus as gpu}
                  <article class="device-row">
                    <div class="device-mark purple"><Icon name="chip" /></div>
                    <div class="device-main"><strong>{gpu.model}</strong><span>{gpu.vendor}</span></div>
                    <dl class="inline-specs"><div><dt>PCI ID</dt><dd>{gpu.vendorId ?? '—'}:{gpu.deviceId ?? '—'}</dd></div><div><dt>Driver</dt><dd>{gpu.driver}</dd></div></dl>
                  </article>
                {/each}
              </div>
            {:else}<div class="empty-state"><div class="empty-icon">GPU</div><strong>No graphics adapter detected</strong><span>{info?.diagnostics.gpuStatus ?? 'Waiting for the hardware probe.'}</span></div>{/if}
            {#if gpuConsumers.length}
              <div class="list-title">GPU consumers</div>
              <div class="device-list">
                {#each gpuConsumers as consumer (consumer.name)}
                  <article class="device-row">
                    <div class="device-main"><strong>{consumer.name}</strong><span>WDDM GPU engine</span></div>
                    <dl class="inline-specs"><div><dt>Utilization</dt><dd>{consumer.pct.toFixed(0)}%</dd></div></dl>
                  </article>
                {/each}
              </div>
            {/if}
          {:else if selected === 'memory'}
            <div class="memory-summary"><div><span>Total memory</span><strong>{memory ? fmtBytes(memory.totalBytes) : '—'}</strong></div><div><span>Available</span><strong>{memory ? fmtBytes(memory.availableBytes) : '—'}</strong></div><div><span>Modules</span><strong>{memory?.modules.length ?? 0}</strong></div></div>
            <div class="table-wrap"><table><caption class="sr-only">Memory modules</caption><thead><tr><th aria-sort={memAriaSort('bank')}><button class="sort-btn" class:active={memSortKey === 'bank'} onclick={() => toggleMemSort('bank')}>Slot {memIndicator('bank')}</button></th><th aria-sort={memAriaSort('sizeBytes')}><button class="sort-btn" class:active={memSortKey === 'sizeBytes'} onclick={() => toggleMemSort('sizeBytes')}>Size {memIndicator('sizeBytes')}</button></th><th aria-sort={memAriaSort('type')}><button class="sort-btn" class:active={memSortKey === 'type'} onclick={() => toggleMemSort('type')}>Type {memIndicator('type')}</button></th><th aria-sort={memAriaSort('clockMHz')}><button class="sort-btn" class:active={memSortKey === 'clockMHz'} onclick={() => toggleMemSort('clockMHz')}>Speed {memIndicator('clockMHz')}</button></th><th aria-sort={memAriaSort('manufacturer')}><button class="sort-btn" class:active={memSortKey === 'manufacturer'} onclick={() => toggleMemSort('manufacturer')}>Manufacturer {memIndicator('manufacturer')}</button></th></tr></thead><tbody>{#each memModules as module, index}<tr><td>{module.bank !== '—' ? module.bank : `Slot ${index + 1}`}</td><td>{fmtBytes(module.sizeBytes)}</td><td>{module.type}</td><td>{value(module.clockMHz, ' MHz')}</td><td>{module.manufacturer}</td></tr>{/each}</tbody></table></div>
          {:else if selected === 'storage'}
            <div class="device-list">
              {#each disks as disk}
                <article class="device-row"><div class="device-mark orange"><Icon name="chip" /></div><div class="device-main"><strong>{disk.vendor !== '—' ? `${disk.vendor} · ${disk.model}` : disk.model}</strong><span>{disk.type}</span></div><dl class="inline-specs"><div><dt>Capacity</dt><dd>{fmtBytes(disk.sizeBytes)}</dd></div><div><dt>Interface</dt><dd>{disk.interfaceType}</dd></div></dl></article>
              {:else}<div class="empty-state"><div class="empty-icon">SSD</div><strong>No drives detected</strong><span>Drive inventory is unavailable from this runtime.</span></div>{/each}
            </div>
          {:else if selected === 'network'}
            <div class="device-list">
              {#each networks as network}
                <article class="device-row"><div class="device-mark blue"><Icon name="chip" /></div><div class="device-main"><strong>{network.name}</strong><span>{network.type}</span></div><dl class="inline-specs"><div><dt>Speed</dt><dd>{value(network.speedMbps, ' Mbps')}</dd></div><div><dt>State</dt><dd>{network.state}</dd></div></dl></article>
              {:else}<div class="empty-state"><div class="empty-icon">NET</div><strong>No network adapters detected</strong><span>Network inventory is unavailable from this runtime.</span></div>{/each}
            </div>
          {:else if selected === 'motherboard'}
            <div class="hero-value">{motherboard?.model ?? 'Motherboard data unavailable'}</div>
            <dl class="spec-grid">
              <div><dt>Manufacturer</dt><dd>{motherboard?.manufacturer ?? '—'}</dd></div>
              <div><dt>Model</dt><dd>{motherboard?.model ?? '—'}</dd></div>
              <div><dt>Chipset</dt><dd>{motherboard?.chipset ?? '—'}</dd></div>
              <div><dt>BIOS vendor</dt><dd>{bios?.vendor ?? '—'}</dd></div>
              <div><dt>BIOS version</dt><dd>{bios?.version ?? '—'}</dd></div>
              <div><dt>BIOS date</dt><dd>{bios?.releaseDate ?? '—'}</dd></div>
            </dl>
          {:else if selected === 'system'}
            <div class="hero-value">{os?.distro ?? 'Operating system unavailable'}</div>
            <dl class="spec-grid">
              <div><dt>Distribution</dt><dd>{os?.distro ?? '—'}</dd></div>
              <div><dt>Version</dt><dd>{os?.release ?? '—'}</dd></div>
              <div><dt>Build</dt><dd>{os?.build ?? '—'}</dd></div>
              <div><dt>Architecture</dt><dd>{os?.arch ?? '—'}</dd></div>
              <div><dt>Hostname</dt><dd>{os?.hostname ?? '—'}</dd></div>
              <div><dt>Platform</dt><dd>{os?.platform ?? '—'}</dd></div>
            </dl>
          {/if}
        </div>
      {/key}
    </section>
  </section>
</div>

<style>
  .page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; }
  h1, h2 { margin: 0; letter-spacing: -0.02em; }
  h1 { font-size: 21px; font-weight: 650; line-height: 1.2; }
  h2 { font-size: 20px; }
  .sub { margin: 4px 0 0; color: var(--fg-2); font-size: 13px; }
  .eyebrow { color: var(--fg-2); font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
  .source { margin-left: 8px; color: var(--fg-1); font-family: var(--mono); letter-spacing: 0; text-transform: none; }
  .pulse, .scan-state span, .status-pill span { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--warn); vertical-align: middle; }
  .pulse { margin-right: 7px; background: var(--accent-2); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-2) 14%, transparent); }
  .scan-state { color: var(--fg-2); font-size: 12px; white-space: nowrap; }
  .scan-state span { margin-right: 7px; }
  .scan-state span.ready, .status-pill span { background: var(--accent-2); }
  .overview { display: grid; grid-template-columns: repeat(auto-fit, minmax(185px, 1fr)); gap: 12px; }
  .overview-card { position: relative; min-width: 0; padding: 16px; display: flex; flex-direction: column; align-items: flex-start; gap: 10px; text-align: left; background: var(--bg-1); border: 1px solid var(--border-subtle); border-radius: 12px; overflow: hidden; transition: border-color 180ms ease, transform 180ms ease, background 180ms ease; }
  .overview-card::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--card-accent); }
  .overview-card:hover, .overview-card.active { background: var(--bg-2); border-color: color-mix(in srgb, var(--card-accent) 55%, var(--border)); }
  .overview-card:hover { transform: translateY(-2px); }
  .accent-blue { --card-accent: var(--chart-blue); } .accent-purple { --card-accent: var(--chart-violet); } .accent-green { --card-accent: var(--chart-emerald); } .accent-orange { --card-accent: var(--chart-amber); }
  .card-top { display: flex; align-items: center; gap: 8px; color: var(--fg-2); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .icon-badge, .nav-icon, .device-mark { display: grid; place-items: center; color: var(--card-accent); }
  .icon-badge { width: 25px; height: 25px; border-radius: 7px; background: color-mix(in srgb, var(--card-accent) 14%, transparent); }
  .overview-card strong { display: -webkit-box; width: 100%; overflow: hidden; color: var(--fg-0); font-family: var(--mono); font-size: 14px; line-height: 1.35; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
  .overview-card small { color: var(--fg-2); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hardware-workspace { display: grid; grid-template-columns: 245px minmax(0, 1fr); min-height: 380px; background: var(--bg-1); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow); flex: none; }
  .hardware-nav { padding: 14px 10px; border-right: 1px solid var(--border-subtle); background: color-mix(in srgb, var(--bg-0) 28%, var(--bg-1)); }
  .nav-heading { padding: 4px 10px 10px; color: var(--fg-2); font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
  .hardware-nav-item { position: relative; width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid transparent; background: transparent; color: var(--fg-1); text-align: left; transition: background 180ms ease, color 180ms ease, border-color 180ms ease; }
  .hardware-nav-item:hover { background: var(--bg-2); color: var(--fg-0); }
  .hardware-nav-item.active { background: color-mix(in srgb, var(--accent) 10%, var(--bg-2)); border-color: color-mix(in srgb, var(--accent) 32%, var(--border)); color: var(--fg-0); }
  .hardware-nav-item.active::before { content: ''; position: absolute; left: -11px; top: 8px; bottom: 8px; width: 2px; background: var(--accent); border-radius: 2px; }
  .nav-icon { width: 28px; height: 28px; flex: 0 0 auto; border-radius: 7px; background: var(--bg-2); color: var(--fg-2); }
  .active .nav-icon { color: var(--accent); background: color-mix(in srgb, var(--accent) 13%, var(--bg-2)); }
  .nav-copy { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .nav-copy strong { font-size: 12px; } .nav-copy small { overflow: hidden; color: var(--fg-2); font-family: var(--mono); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .nav-arrow { width: 6px; height: 6px; margin-left: auto; border-top: 1px solid currentColor; border-right: 1px solid currentColor; opacity: .4; transform: rotate(45deg); }
  .nav-footer { margin: 28px 10px 4px; color: var(--fg-2); font-size: 10px; line-height: 1.5; } .nav-footer strong { color: var(--fg-1); font-family: var(--mono); font-weight: 500; }
  .detail-panel { min-width: 0; background: var(--bg-1); }
  .detail-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 24px; border-bottom: 1px solid var(--border-subtle); }
  .status-pill { padding: 5px 8px; border: 1px solid var(--border-subtle); border-radius: 20px; color: var(--fg-2); font-size: 10px; white-space: nowrap; } .status-pill span { margin-right: 5px; }
  .detail-content { padding: 24px; animation: detail-in 220ms cubic-bezier(.2,.8,.2,1); }
  .hero-value { max-width: 720px; margin-bottom: 22px; color: var(--fg-0); font-family: var(--mono); font-size: clamp(18px, 2.2vw, 26px); font-weight: 600; letter-spacing: -.03em; }
  .spec-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; margin: 0; overflow: hidden; border: 1px solid var(--border-subtle); border-radius: 10px; background: var(--border-subtle); }
  .spec-grid > div { min-width: 0; padding: 14px; background: var(--bg-1); } dt, .memory-summary span { color: var(--fg-2); font-size: 10px; text-transform: uppercase; letter-spacing: .07em; } dd { margin: 5px 0 0; overflow: hidden; color: var(--fg-1); font-family: var(--mono); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .device-list { display: flex; flex-direction: column; gap: 8px; }
  .device-row { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 13px; border: 1px solid var(--border-subtle); border-radius: 10px; background: color-mix(in srgb, var(--bg-2) 35%, var(--bg-1)); transition: border-color 180ms ease, background 180ms ease; } .device-row:hover { border-color: var(--border); background: var(--bg-2); }
  .device-mark { width: 34px; height: 34px; flex: 0 0 auto; border-radius: 9px; background: color-mix(in srgb, currentColor 13%, transparent); } .device-mark.purple { color: var(--chart-violet); } .device-mark.orange { color: var(--chart-amber); } .device-mark.blue { color: var(--chart-blue); }
  .device-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; } .device-main strong { overflow: hidden; color: var(--fg-0); font-family: var(--mono); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; } .device-main span { color: var(--fg-2); font-size: 11px; }
  .inline-specs { display: flex; gap: 24px; margin: 0; } .inline-specs dd { text-align: right; }
  .memory-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 18px; } .memory-summary > div { padding: 12px; border: 1px solid var(--border-subtle); border-radius: 9px; } .memory-summary strong { display: block; margin-top: 4px; color: var(--fg-0); font-family: var(--mono); font-size: 16px; }
  .table-wrap { overflow-x: auto; border: 1px solid var(--border-subtle); border-radius: 10px; } table { width: 100%; border-collapse: collapse; min-width: 580px; } th, td { padding: 11px 13px; border-bottom: 1px solid var(--border-subtle); text-align: left; font-size: 11px; } th { color: var(--fg-2); font-size: 10px; text-transform: uppercase; letter-spacing: .07em; } td { color: var(--fg-1); font-family: var(--mono); } tr:last-child td { border-bottom: 0; }
  .sort-btn { background: none; border: none; padding: 0; color: inherit; font: inherit; text-transform: inherit; letter-spacing: inherit; cursor: pointer; }
  .sort-btn.active { color: var(--fg-0); }
  .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 230px; gap: 8px; color: var(--fg-2); text-align: center; } .empty-state strong { color: var(--fg-1); } .empty-icon { display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: 4px; border: 1px solid var(--border); border-radius: 12px; color: var(--fg-2); font-family: var(--mono); font-size: 10px; }
  @keyframes detail-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  @media (prefers-reduced-motion: reduce) { .overview-card, .hardware-nav-item, .device-row { transition: none; } .detail-content { animation: none; } }
  @media (max-width: 900px) { .overview { grid-template-columns: repeat(2, minmax(0, 1fr)); } .hardware-workspace { grid-template-columns: 190px minmax(0, 1fr); } .spec-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 640px) { .page-header { align-items: flex-start; flex-direction: column; } .overview { grid-template-columns: 1fr; } .hardware-workspace { display: block; } .hardware-nav { display: flex; gap: 6px; overflow-x: auto; padding: 8px; border-right: 0; border-bottom: 1px solid var(--border-subtle); } .nav-heading, .nav-footer, .nav-copy small, .nav-arrow { display: none; } .hardware-nav-item { width: auto; flex: 0 0 auto; padding: 8px 10px; } .hardware-nav-item.active::before { inset: auto 8px -9px; width: auto; height: 2px; } .nav-copy strong { white-space: nowrap; } .detail-header, .detail-content { padding: 18px; } .spec-grid { grid-template-columns: 1fr; } .memory-summary { grid-template-columns: 1fr; } .device-row { align-items: flex-start; flex-wrap: wrap; } .inline-specs { width: calc(100% - 46px); margin-left: 46px; justify-content: space-between; } }
</style>
