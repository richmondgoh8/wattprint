// Tiny Svelte 5 stores using $state runes (Svelte 5 native).
// These are imported by views and components.

import type { Readiness, Snapshot, Settings, SystemInfo } from './wails';

export type Route = 'live' | 'calculator' | 'info' | 'top' | 'forecast' | 'settings';

export const route = $state<{ current: Route }>({ current: 'live' });

export const snapshot = $state<{ latest: Snapshot | null }>({ latest: null });
export const status = $state<{ message: string }>({ message: 'initializing…' });
export const settings = $state<{ value: Settings | null }>({ value: null });
export const systemInfo = $state<{ value: SystemInfo | null }>({ value: null });
export const readiness = $state<{ value: Readiness | null }>({ value: null });

// Rolling buffer of the last N samples for sparkline/live chart.
// Length adapts to the sample interval so it always spans ~2 minutes.
// Only the numeric series the chart consumes are retained — full snapshots
// (up to 1000 processes) are not needed for a 2-minute sparkline.
export interface BufferSample {
  ts: string;
  totalW: number;
  components: Record<string, number | null>;
}

export const liveBuffer = $state<{ samples: BufferSample[]; maxLen: number }>({
  samples: [],
  maxLen: 120,
});

export function setBufferSeconds(seconds: number): void {
  liveBuffer.maxLen = Math.max(120, Math.round(seconds) * 120);
}

export function pushSample(s: Snapshot): void {
  snapshot.latest = s;
  const buf = liveBuffer.samples;
  buf.push({ ts: s.ts, totalW: s.totalW, components: s.components });
  if (buf.length > liveBuffer.maxLen) buf.splice(0, buf.length - liveBuffer.maxLen);
}

export function resetLive(): void {
  snapshot.latest = null;
  liveBuffer.samples = [];
}

/** Apply the theme choice to <html data-theme>. */
export function applyTheme(theme: 'system' | 'light' | 'dark'): void {
  document.documentElement.dataset.theme = theme;
}
