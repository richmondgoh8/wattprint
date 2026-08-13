// Insights: engagement numbers computed from measured history.
// Annualized cost, top annualized apps, "quit X saves $Y" ranking, weekly
// trend, idle-cost share, and measured-vs-modeled share.

import { machineStateTotals, totalsByKey } from './store.js'
import { compute as forecastCompute } from './forecast.js'
import type { Insights, Settings } from '../shared/types.js'

const WINDOW_DAYS = 30

/** Settings are passed in so this module stays free of electron/config deps
 *  and can run inside the query worker thread. */
export function compute(s: Settings, now: Date = new Date()): Insights {
  const from = new Date(now.getTime() - WINDOW_DAYS * 24 * 3600 * 1000)
  const daysCovered = Math.max(1, (now.getTime() - from.getTime()) / (24 * 3600 * 1000))

  const forecast = forecastCompute(s.costPerKWh, s.currency, now)
  const annualKWh = forecast.projectedKWhMonth * 12
  const annualCost = forecast.projectedCostMonth * 12

  const procs = totalsByKey(from, now, 'process')
  const topApps = procs.slice(0, 5).map((r) => ({
    key: r.key,
    annualKWh: (r.kWh * 365) / daysCovered,
    annualCost: (r.kWh * 365 * s.costPerKWh) / daysCovered
  }))
  const savings = topApps.slice(0, 3)

  // Weekly trend: total component kWh this week vs the previous one.
  const weekMs = 7 * 24 * 3600 * 1000
  const thisWeek = componentKwh(new Date(now.getTime() - weekMs), now)
  const lastWeek = componentKwh(new Date(now.getTime() - 2 * weekMs), new Date(now.getTime() - weekMs))
  const weeklyTrendPct =
    lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : null

  // Idle share: idle + screen-off energy from the machine-state ledger.
  const states = machineStateTotals(from, now)
  const idleKWh = states
    .filter((st) => st.state === 'idle' || st.state === 'screen-off')
    .reduce((sum, st) => sum + st.kWh, 0)
  const stateKWh = states.reduce((sum, st) => sum + st.kWh, 0)

  return {
    annualCost,
    annualKWh,
    topApps,
    savings,
    weeklyTrendPct,
    idleCost: idleKWh * s.costPerKWh,
    idleKWh,
    idleSharePct: stateKWh > 0 ? (idleKWh / stateKWh) * 100 : 0,
    measuredSharePct: forecast.hasEnoughData ? forecast.measuredSharePct : null
  }
}

function componentKwh(from: Date, to: Date): number {
  return totalsByKey(from, to, 'component').reduce((sum, r) => sum + r.kWh, 0)
}
