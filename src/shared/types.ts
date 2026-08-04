// Shared types between main, preload, and renderer processes.
// Single source of truth for the IPC contract.

export type ComponentKey = 'cpu' | 'gpu' | 'ram' | 'disk' | 'net';

export interface ProcessSample {
  pid: number;
  name: string;
  cpuW: number;
  gpuW: number;
  w: number;
}

export interface Snapshot {
  ts: string; // ISO 8601
  components: Record<string, number>;
  processes: ProcessSample[];
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

/** The shape exposed by preload's contextBridge as window.api. */
export interface WattprintAPI {
  // Lifecycle
  start(): Promise<void>;
  getSettings(): Promise<Settings>;
  updateSettings(s: Settings): Promise<void>;

  // Queries
  viewTotals(fromIso: string, toIso: string, scope: string): Promise<KeyTotal[]>;
  viewHourly(fromIso: string, toIso: string, scope: string, key: string): Promise<HourlyRollup[]>;
  viewForecast(): Promise<ForecastResult>;

  // Events
  onSample(cb: (s: Snapshot) => void): () => void;
  onStatus(cb: (s: string) => void): () => void;
}
