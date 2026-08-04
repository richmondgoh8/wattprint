// Typed wrappers around the auto-generated wailsjs bindings.
// The shape here is the source of truth for the frontend; if the
// Go App struct changes, these need to be kept in sync.

import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';
import * as Backend from '../../wailsjs/go/app/App';

export type ComponentKey = 'cpu' | 'gpu' | 'ram' | 'disk' | 'net';

export interface Snapshot {
  ts: string; // ISO 8601
  components: Record<string, number>;
  processes: { pid: number; name: string; cpuW: number; gpuW: number; w: number }[];
  totalW: number;
}

export interface KeyTotal {
  scope: string;
  key: string;
  kWh: number;
  avgW: number;
  maxW: number;
}

export interface HourlyRollup {
  hour: string;
  scope: string;
  key: string;
  kWh: number;
  avgW: number;
  maxW: number;
  minutes: number;
}

export interface ForecastResult {
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  hoursCovered: number;
  kWhInWindow: number;
  avgKWhPerHour: number;
  stdDevKWhPerHour: number;
  projectedKWhPerDay: number;
  projectedKWhMonth: number;
  projectedCostMonth: number;
  projectedCO2Kg: number;
  currency: string;
  costPerKWh: number;
  gridCarbonGCO2PerKWh: number;
  lowKWhMonth: number;
  highKWhMonth: number;
  lowCostMonth: number;
  highCostMonth: number;
  hasEnoughData: boolean;
}

export interface Settings {
  costPerKWh: number;
  currency: string;
  gridCarbonIntensity: number;
  forecastWindowDays: number;
  sampleIntervalSeconds: number;
  startOnLogin: boolean;
  theme: string;
}

// ---- bound methods ----
export const start = (): Promise<void> => Backend.Start();
export const getSettings = (): Promise<Settings> => Backend.GetSettings();
export const updateSettings = (s: Settings): Promise<void> => Backend.UpdateSettings(s);
export const viewTotals = (from: Date, to: Date, scope: string): Promise<KeyTotal[]> =>
  Backend.ViewTotals(from.toISOString(), to.toISOString(), scope);
export const viewHourly = (from: Date, to: Date, scope: string, key: string): Promise<HourlyRollup[]> =>
  Backend.ViewHourly(from.toISOString(), to.toISOString(), scope, key);
export const viewForecast = (): Promise<ForecastResult> => Backend.ViewForecast();

// ---- event subscription ----
export function onSample(cb: (s: Snapshot) => void): () => void {
  EventsOn('sample', (s: unknown) => cb(s as Snapshot));
  return () => EventsOff('sample');
}
export function onStatus(cb: (s: string) => void): () => void {
  EventsOn('status', (s: unknown) => cb(s as string));
  return () => EventsOff('status');
}
