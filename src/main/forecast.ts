// Forecast: trailing-window average projection.
// Port of internal/forecast/forecast.go.

import { hourlyRange } from './store.js'

export interface ForecastResult {
  windowDays: number
  windowStart: string
  windowEnd: string
  hoursCovered: number
  kWhInWindow: number
  measuredKWh: number
  measuredSharePct: number
  avgKWhPerHour: number
  stdDevKWhPerHour: number
  projectedKWhPerDay: number
  projectedKWhMonth: number
  projectedCostMonth: number
  currency: string
  costPerKWh: number
  lowKWhMonth: number
  highKWhMonth: number
  lowCostMonth: number
  highCostMonth: number
  hasEnoughData: boolean
}

const DAYS_IN_MONTH = 30

/** Single, fixed projection window: the trailing 30 days. Only hours with a
 *  real rollup count, so on/off tracking still uses every tracked hour within
 *  the window without gaps diluting the average. */
const WINDOW_DAYS = 30

export function compute(
  costPerKWh: number,
  currency: string,
  now: Date = new Date()
): ForecastResult {
  const endHour = new Date(
    Math.floor(now.getTime() / 3600000) * 3600000
  )
  const startHour = new Date(endHour.getTime() - WINDOW_DAYS * 24 * 3600 * 1000)

  const rolls = hourlyRange(startHour, endHour, 'component')

  // Aggregate per-hour total kWh across all keys
  const perHour = new Map<number, number>()
  const perHourMeasured = new Map<number, number>()
  for (const r of rolls) {
    const t = Math.floor(new Date(r.hour).getTime() / 1000)
    perHour.set(t, (perHour.get(t) ?? 0) + r.kWh)
    if (r.gpuKWh > 0) perHourMeasured.set(t, (perHourMeasured.get(t) ?? 0) + r.gpuKWh)
  }

  // Use only hours with a real rollup. Missing history must not dilute the
  // average or appear as observed zero-power hours.
  const values: number[] = []
  let totalKWh = 0
  let totalMeasuredKWh = 0
  for (let t = startHour.getTime(); t < endHour.getTime(); t += 3600 * 1000) {
    const sec = Math.floor(t / 1000)
    const v = perHour.get(sec)
    if (v != null) {
      values.push(v)
      totalKWh += v
      totalMeasuredKWh += perHourMeasured.get(sec) ?? 0
    }
  }
  const hoursCovered = values.length
  const avgKWhPerHour = hoursCovered > 0 ? totalKWh / hoursCovered : 0
  const measuredSharePct = totalKWh > 0 ? Math.min(100, (totalMeasuredKWh / totalKWh) * 100) : 0

  // Sample std dev (n-1)
  let stdDev = 0
  if (hoursCovered > 1) {
    let sumSq = 0
    for (const v of values) {
      const d = v - avgKWhPerHour
      sumSq += d * d
    }
    stdDev = Math.sqrt(sumSq / (hoursCovered - 1))
  }

  const projKWhPerDay = avgKWhPerHour * 24
  const projKWhMonth = avgKWhPerHour * 24 * DAYS_IN_MONTH
  const projCost = projKWhMonth * costPerKWh
  const sigmaMonth = stdDev * 24 * DAYS_IN_MONTH
  const lowKWh = Math.max(0, projKWhMonth - sigmaMonth)
  const highKWh = projKWhMonth + sigmaMonth

  return {
    windowDays: WINDOW_DAYS,
    windowStart: startHour.toISOString(),
    windowEnd: endHour.toISOString(),
    hoursCovered,
    kWhInWindow: totalKWh,
    measuredKWh: totalMeasuredKWh,
    measuredSharePct,
    avgKWhPerHour,
    stdDevKWhPerHour: stdDev,
    projectedKWhPerDay: projKWhPerDay,
    projectedKWhMonth: projKWhMonth,
    projectedCostMonth: projCost,
    currency,
    costPerKWh,
    lowKWhMonth: lowKWh,
    highKWhMonth: highKWh,
    lowCostMonth: lowKWh * costPerKWh,
    highCostMonth: highKWh * costPerKWh,
    hasEnoughData: hoursCovered >= 6
  }
}
