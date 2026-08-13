// Shared types between main, preload, and renderer processes.
// Single source of truth for the IPC contract.

export type ComponentKey = 'cpu' | 'gpu' | 'ram' | 'disk' | 'net';

export interface ProcessSample {
  pid: number;
  name: string;
  cpuW: number;
  gpuW: number;
  w: number;
  /** CPU usage as percent of one core (100% = one full core). */
  cpuPct: number;
  /** Working-set memory in bytes. */
  memoryBytes: number;
}

export type SourceKind = 'measured' | 'estimated' | 'unavailable';

export interface Snapshot {
  ts: string; // ISO 8601
  /** Per-component watts. `null` means no sensor / not applicable (e.g. no GPU). */
  components: Record<string, number | null>;
  /** How each component's watts were produced. `unavailable` = no reading at all. */
  componentSources: Record<string, SourceKind>;
  /** Reference TDP used for the CPU model (null = no reference resolved). */
  cpuTdpW: number | null;
  /** True when cpuTdpW came from the hardware lookup, false for the 95 W default. */
  cpuTdpResolved: boolean;
  sleepMode: SleepModeState;
  processes: ProcessSample[];
  /** Total number of processes on the system (including idle ones). */
  processCount: number;
  /** GPU utilization percentage (0-100) from host counters, if available. */
  gpuUtilPct: number | null;
  /** Top GPU engine consumer (process name + engine %), if any. */
  gpuTopProcess: { name: string; pct: number } | null;
  /** Top GPU engine consumers by process, sorted descending. */
  gpuConsumers: { name: string; pct: number }[];
  /** Total CPU load percentage (100% = all cores), if primed. */
  cpuLoadPct: number | null;
  /** OS memory usage in bytes. */
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  totalW: number;
}

export interface KeyTotal {
  scope: string;
  key: string;
  kWh: number;
  /** Process rows only: energy attributed to the GPU (0 when unavailable). */
  gpuKWh: number;
  avgW: number;
  maxW: number;
}

export interface HourlyRollup {
  hour: string;
  scope: string;
  key: string;
  kWh: number;
  gpuKWh: number;
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
  currency: string;
  costPerKWh: number;
  lowKWhMonth: number;
  highKWhMonth: number;
  lowCostMonth: number;
  highCostMonth: number;
  /** kWh measured by real sensors (GPU) inside the window. */
  measuredKWh: number;
  /** measuredKWh / kWhInWindow, 0 when no window energy. */
  measuredSharePct: number;
  hasEnoughData: boolean;
}

export interface SleepModeSettings {
  /** Process names that keep full speed during Sleep Mode (case-insensitive). */
  whitelist: string[]
}

export interface SleepModeState {
  active: boolean
  /** True when the platform supports EcoQoS throttling (Windows 10 2004+). */
  supported: boolean
  since: string | null
  baselineW: number
  throttledCount: number
}

export interface Settings {
  costPerKWh: number
  currency: string
  sampleIntervalSeconds: number
  startOnLogin: boolean
  closeToTray: boolean
  theme: 'system' | 'light' | 'dark'
  sleepMode: SleepModeSettings
}

export interface SleepSession {
  start: string
  end: string
  avgW: number
  baselineW: number
  kWh: number
  savedKWh: number
  throttledCount: number
}

export type MachineState = 'active' | 'idle' | 'screen-off' | 'sleep' | 'off';

export interface MachineStateRow {
  from: string
  to: string
  state: MachineState
  avgW: number
  kWh: number
}

export interface AppAnnual {
  key: string
  annualKWh: number
  annualCost: number
}

export interface Insights {
  annualCost: number
  annualKWh: number
  topApps: AppAnnual[]
  savings: AppAnnual[]
  weeklyTrendPct: number | null
  idleCost: number
  idleKWh: number
  idleSharePct: number
  measuredSharePct: number | null
}

/** One bundled reference figure used for benchmarking, with provenance. */
export interface BenchmarkReference {
  label: string
  avgKWhYear: number
  /** Median where published (desktop PCs); null otherwise. */
  medianKWhYear: number | null
  source: string
  asOf: string
}

/** How much actual tracked time the history represents (summed, not
 *  wall-clock span) — e.g. on/off usage over 3 days that only sums to 2 h.
 *  activeHours is the subset with real user activity (below the idle
 *  threshold), from the machine-state ledger. */
export interface TrackingInfo {
  firstTrackedAt: string | null
  lastTrackedAt: string | null
  coveredHours: number
  activeHours: number
}

/** All-time usage (first tracked sample → now) plus the reference set to
 *  compare against. Computed on the main side so the renderer just renders. */
export interface Benchmark {
  firstTrackedAt: string | null
  lastTrackedAt: string | null
  /** Actual covered minutes (not wall-clock span), in hours. */
  coveredHours: number
  /** Hours with real user activity (below the idle threshold). */
  activeHours: number
  totalKWh: number
  avgW: number
  /** avgW held constant for a full year. */
  projectedKWhYear: number
  desktop: BenchmarkReference
  gaming: BenchmarkReference
  household: BenchmarkReference
}

export interface Readiness {
  status: string
  processCount: number
  startedAt: string | null
  lastSampleAt: string | null
  lastHourlyRollupAt: string | null
  nextHourlyDataAt: string
  sampleIntervalSeconds: number
  hourlyBucketsAvailable: number
  forecastBucketsRequired: number
  processSamplesAvailable: boolean
}

export interface SystemInfo {
  cpu: {
    brand: string
    manufacturer: string
    socket: string
    cores: number
    physicalCores: number
    speedGHz: number
    speedMinGHz: number
    speedMaxGHz: number
    cache: { l1dBytes: number; l1iBytes: number; l2Bytes: number; l3Bytes: number }
    virtualization: boolean | null
    codename: string
    tdpW: number | null
  }
  motherboard: {
    manufacturer: string
    model: string
    version: string
    chipset: string
  }
  bios: {
    vendor: string
    version: string
    releaseDate: string
  }
  memory: {
    totalBytes: number
    usedBytes: number
    freeBytes: number
    availableBytes: number
    swapTotalBytes: number
    swapUsedBytes: number
    modules: {
      sizeBytes: number
      bank: string
      type: string
      formFactor: string
      clockMHz: number | null
      manufacturer: string
      partNumber: string
      serialNumber: string
      ecc: boolean | null
      voltageMv: number | null
    }[]
  }
  gpus: {
    vendor: string
    model: string
    vendorId: string | null
    deviceId: string | null
    bus: string
    busAddress: string | null
    vramBytes: number | null
    vramDynamic: boolean
    driver: string
    status: string
    utilizationGpu: number | null
    utilizationMemory: number | null
    temperatureC: number | null
    powerDrawW: number | null
    note: string | null
  }[]
  disks: {
    device: string
    model: string
    vendor: string
    type: string
    sizeBytes: number
    interfaceType: string
    firmware: string
    serialNumber: string
    temperatureC: number | null
    smartStatus: string
  }[]
  networks: {
    name: string
    type: string
    speedMbps: number | null
    mac: string
    ip4: string
    state: string
    duplex: string
    virtual: boolean
  }[]
  diagnostics: {
    runtime: string
    gpuSource: string
    gpuStatus: string
  }
  os: {
    platform: string
    release: string
    hostname: string
    build: string
    arch: string
    distro: string
  }
}

/** The shape exposed by preload's contextBridge as window.api. */
export interface WattprintAPI {
  // Lifecycle
  start(): Promise<void>
  resetStatistics(): Promise<void>
  getSettings(): Promise<Settings>
  updateSettings(s: Partial<Settings>): Promise<Settings>
  getSystemInfo(): Promise<SystemInfo>
  getReadiness(): Promise<Readiness>

  // Queries
  viewTotals(fromIso: string, toIso: string, scope: string): Promise<KeyTotal[]>
  viewForecast(): Promise<ForecastResult>
  viewMachineStates(fromIso: string, toIso: string): Promise<MachineStateRow[]>
  getInsights(): Promise<Insights>
  getSleepSessions(fromIso: string, toIso: string): Promise<SleepSession[]>
  /** Summed tracked time + first/last tracked timestamps. Pass `fromIso` to
   *  bound the summed coverage to a window (e.g. the current month). */
  getTrackingInfo(fromIso?: string | null): Promise<TrackingInfo>
  getBenchmark(): Promise<Benchmark>

  // Actions
  setSleepMode(on: boolean): Promise<void>

  // Events
  onSample(cb: (s: Snapshot) => void): () => void
  onStatus(cb: (s: string) => void): () => void
}
