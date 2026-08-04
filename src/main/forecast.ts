// Forecast: trailing-window average projection.
// Port of internal/forecast/forecast.go.

import { hourlyRange } from './store.js'

export interface ForecastResult {
  windowDays: number
  windowStart: string
  windowEnd: string
  hoursCovered: number
  kWhInWindow: number
  avgKWhPerHour: number
  stdDevKWhPerHour: number
  projectedKWhPerDay: number
  projectedKWhMonth: number
  projectedCostMonth: number
  projectedCO2Kg: number
  currency: string
  costPerKWh: number
  gridCarbonGCO2PerKWh: number
  lowKWhMonth: number
  highKWhMonth: number
  lowCostMonth: number
  highCostMonth: number
  hasEnoughData: boolean
}

const DAYS_IN_MONTH = 30

export function compute(
  windowDays: number,
  costPerKWh: number,
  gridGCO2: number,
  currency: string,
  now: Date = new Date()
): ForecastResult {
  const d = Math.max(1, Math.min(365, windowDays))
  const endHour = new Date(
    Math.floor(now.getTime() / 3600000) * 3600000 + 3600000
  )
  const startHour = new Date(endHour.getTime() - d * 24 * 3600 * 1000)

  const rolls = hourlyRange(startHour, endHour, '')

  // Aggregate per-hour total kWh across all keys
  const perHour = new Map<number, number>()
  for (const r of rolls) {
    const t = Math.floor(new Date(r.hour).getTime() / 1000)
    perHour.set(t, (perHour.get(t) ?? 0) + r.kWh)
  }

  // Continuous hour list, zero-filling
  const values: number[] = []
  let totalKWh = 0
  for (let t = startHour.getTime(); t < endHour.getTime(); t += 3600 * 1000) {
    const sec = Math.floor(t / 1000)
    const v = perHour.get(sec) ?? 0
    values.push(v)
    totalKWh += v
  }
  const hoursCovered = values.length
  const avgKWhPerHour = hoursCovered > 0 ? totalKWh / hoursCovered : 0

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
  const projCO2 = (projKWhMonth * gridGCO2) / 1000 // g → kg

  const sigmaMonth = stdDev * 24 * DAYS_IN_MONTH
  const lowKWh = Math.max(0, projKWhMonth - sigmaMonth)
  const highKWh = projKWhMonth + sigmaMonth

  return {
    windowDays: d,
    windowStart: startHour.toISOString(),
    windowEnd: endHour.toISOString(),
    hoursCovered,
    kWhInWindow: totalKWh,
    avgKWhPerHour,
    stdDevKWhPerHour: stdDev,
    projectedKWhPerDay: projKWhPerDay,
    projectedKWhMonth: projKWhMonth,
    projectedCostMonth: projCost,
    projectedCO2Kg: projCO2,
    currency,
    costPerKWh,
    gridCarbonGCO2PerKWh: gridGCO2,
    lowKWhMonth: lowKWh,
    highKWhMonth: highKWh,
    lowCostMonth: lowKWh * costPerKWh,
    highCostMonth: highKWh * costPerKWh,
    hasEnoughData: hoursCovered >= 6
  }
}
