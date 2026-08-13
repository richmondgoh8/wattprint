// Benchmark reference figures: bundled static tables (offline, no API key)
// so users can compare against typical consumers. Every number carries its
// source and vintage — they are orientation figures, not exact matches.

import { allTimeComponentStats } from './store.js'
import type { Benchmark, BenchmarkReference, MachineState, Settings } from '../shared/types.js'

// LBNL field-metering study (45 desktops, 2014, San Francisco Bay Area).
const DESKTOP: BenchmarkReference = {
  label: 'Desktop PC',
  avgKWhYear: 194,
  medianKWhYear: 125,
  source: 'LBNL field study',
  asOf: '2014'
}

// CEC-500-2019-042 / Springer (2015): gaming desktops are the most
// energy-intensive PC class; typical gaming systems ~600 kWh/yr.
const GAMING: BenchmarkReference = {
  label: 'Gaming desktop',
  avgKWhYear: 600,
  medianKWhYear: null,
  source: 'CEC / Springer study',
  asOf: '2015–2019'
}

// Average household electricity per year, keyed by the app's currency list
// (EIA 2026 rolling 12-month US; IEA 2023 kWh/household for other markets).
const HOUSEHOLD: Record<string, Omit<BenchmarkReference, 'medianKWhYear'>> = {
  USD: { label: 'US household', avgKWhYear: 10364, source: 'EIA residential sales', asOf: '2026' },
  EUR: { label: 'Germany household', avgKWhYear: 3127, source: 'IEA household electricity', asOf: '2023' },
  GBP: { label: 'UK household', avgKWhYear: 3658, source: 'IEA household electricity', asOf: '2023' },
  MYR: { label: 'Malaysia household', avgKWhYear: 4456, source: 'IEA household electricity', asOf: '2023' },
  SGD: { label: 'Singapore household', avgKWhYear: 4900, source: 'IEA household electricity', asOf: '2023' },
  JPY: { label: 'Japan household', avgKWhYear: 4749, source: 'IEA household electricity', asOf: '2023' },
  CNY: { label: 'China household', avgKWhYear: 2180, source: 'IEA household electricity', asOf: '2023' },
  INR: { label: 'India household', avgKWhYear: 1005, source: 'IEA household electricity', asOf: '2023' },
  AUD: { label: 'Australia household', avgKWhYear: 5919, source: 'IEA household electricity', asOf: '2023' },
  CAD: { label: 'Canada household', avgKWhYear: 11305, source: 'IEA household electricity', asOf: '2023' }
}

export function benchmarkCompute(s: Settings, liveState?: MachineState): Benchmark {
  const stats = allTimeComponentStats(liveState)
  const household = HOUSEHOLD[s.currency] ?? HOUSEHOLD.USD
  return {
    firstTrackedAt: stats.firstTrackedAt,
    lastTrackedAt: stats.lastTrackedAt,
    coveredHours: stats.coveredHours,
    activeHours: stats.activeHours,
    totalKWh: stats.totalKWh,
    avgW: stats.avgW,
    projectedKWhYear: (stats.avgW * 8760) / 1000,
    desktop: DESKTOP,
    gaming: GAMING,
    household: { ...household, medianKWhYear: null }
  }
}
