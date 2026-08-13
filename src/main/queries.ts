// Query handlers shared between the DB worker thread and the inline fallback.
// Pure store access — no electron, no config — so it can run in a worker.

import { totalsMerged, machineStateRange, sleepSessions, getReadiness, trackingCoverage } from './store.js'
import { compute as forecastCompute } from './forecast.js'
import { compute as insightsCompute } from './insights.js'
import { benchmarkCompute } from './benchmarks.js'
import type { MachineState, Settings } from '../shared/types.js'

export type QueryKind =
  | 'totals'
  | 'forecast'
  | 'machineStates'
  | 'insights'
  | 'sleepSessions'
  | 'readiness'
  | 'trackingInfo'
  | 'benchmark'

export type QueryArgs = Record<string, unknown>

function toDate(v: unknown): Date {
  return new Date(v as string)
}

export function runQuery(kind: QueryKind, args: QueryArgs): unknown {
  switch (kind) {
    case 'totals': {
      const from = toDate(args.from)
      const to = toDate(args.to)
      const scope = String(args.scope)
      // Rollups cover every completed hour; the in-progress hour is merged
      // from raw samples. Fast regardless of how large the samples table is.
      return totalsMerged(from, to, scope)
    }
    case 'forecast':
      return forecastCompute(Number(args.costPerKWh), String(args.currency))
    case 'machineStates':
      return machineStateRange(toDate(args.from), toDate(args.to))
    case 'insights':
      return insightsCompute(args.settings as Settings)
    case 'sleepSessions':
      return sleepSessions(toDate(args.from), toDate(args.to))
    case 'readiness':
      return getReadiness(Number(args.windowDays))
    case 'trackingInfo':
      return trackingCoverage(
        args.from != null ? Math.floor(toDate(args.from).getTime() / 1000) : undefined,
        args.liveState != null ? (args.liveState as MachineState) : undefined
      )
    case 'benchmark':
      return benchmarkCompute(args.settings as Settings, args.liveState as MachineState | undefined)
    default:
      throw new Error('unknown query kind: ' + String(kind))
  }
}
