// Tiny Svelte 5 stores using $state runes (Svelte 5 native).
// These are imported by views and components.

import type { Snapshot, Settings } from './wails';

export type Route = 'live' | 'hourly' | 'devices' | 'top' | 'forecast' | 'settings';

export const route = $state<{ current: Route }>({ current: 'live' });

export const snapshot = $state<{ latest: Snapshot | null }>({ latest: null });
export const status = $state<{ message: string }>({ message: 'initializing…' });
export const settings = $state<{ value: Settings | null }>({ value: null });

// Rolling buffer of the last N samples for sparkline/live chart.
export const liveBuffer = $state<{ samples: Snapshot[]; maxLen: number }>({
  samples: [],
  maxLen: 120, // 2 minutes at 1Hz
});

export function pushSample(s: Snapshot): void {
  snapshot.latest = s;
  const buf = liveBuffer.samples;
  buf.push(s);
  if (buf.length > liveBuffer.maxLen) buf.splice(0, buf.length - liveBuffer.maxLen);
}
