// Session 1 stub: minimal types + no-op bindings. Replaced in Session 2
// with real IPC bindings against Electron's preload-exposed window.api.
//
// Renderer must compile against these types now, but the actual data flows
// in via Session 2 (collector + store + ipc.ts).

export type ComponentKey = 'cpu' | 'gpu' | 'ram' | 'disk' | 'net';

export interface Snapshot {
  ts: string;
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

const NOOP = (): void => {};
const unsubNoop = (): void => {};

// --- Session 1 stubs. Will be real in Session 2. ---
export const start = async (): Promise<void> => { /* wired in Session 2 */ };
export const getSettings = async (): Promise<Settings> => ({
  costPerKWh: 0.17,
  currency: 'USD',
  gridCarbonIntensity: 384,
  forecastWindowDays: 7,
  sampleIntervalSeconds: 1,
  startOnLogin: false,
  theme: 'system',
});
export const updateSettings = async (_s: Settings): Promise<void> => { /* wired in Session 2 */ };
export const viewTotals = async (_from: Date, _to: Date, _scope: string): Promise<KeyTotal[]> => [];
export const viewHourly = async (
  _from: Date,
  _to: Date,
  _scope: string,
  _key: string
): Promise<HourlyRollup[]> => [];
export const viewForecast = async (): Promise<ForecastResult> => ({
  windowDays: 7,
  windowStart: new Date().toISOString(),
  windowEnd: new Date().toISOString(),
  hoursCovered: 0,
  kWhInWindow: 0,
  avgKWhPerHour: 0,
  stdDevKWhPerHour: 0,
  projectedKWhPerDay: 0,
  projectedKWhMonth: 0,
  projectedCostMonth: 0,
  projectedCO2Kg: 0,
  currency: 'USD',
  costPerKWh: 0.17,
  gridCarbonGCO2PerKWh: 384,
  lowKWhMonth: 0,
  highKWhMonth: 0,
  lowCostMonth: 0,
  highCostMonth: 0,
  hasEnoughData: false,
});

export const onSample = (_cb: (s: Snapshot) => void): (() => void) => {
  console.warn('[wattprint] onSample is a Session 1 stub; will receive real data in Session 2');
  return unsubNoop;
};
export const onStatus = (cb: (s: string) => void): (() => void) => {
  cb('Session 1 stub — IPC wiring lands in Session 2');
  return unsubNoop;
};
