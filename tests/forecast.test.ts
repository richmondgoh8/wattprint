import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/main/store.js', () => ({
  hourlyRange: vi.fn()
}))

import { hourlyRange } from '../src/main/store.js'
import { compute } from '../src/main/forecast.js'

const NOW = new Date('2026-01-10T12:30:00Z')
const END_HOUR = new Date('2026-01-10T12:00:00Z')
const HOUR_MS = 3600 * 1000

/** ISO hour string `n` hours before the window end. */
function hourIso(offsetHours: number): string {
  return new Date(END_HOUR.getTime() - offsetHours * HOUR_MS).toISOString()
}

function rollup(hour: string, kWh: number, gpuKWh = 0) {
  return { hour, scope: 'component', key: 'cpu', kWh, gpuKWh, avgW: kWh * 1000, maxW: kWh * 1000, minutes: 60 }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('forecast.compute', () => {
  it('returns zeros and hasEnoughData=false for an empty window', () => {
    vi.mocked(hourlyRange).mockReturnValue([])
    const r = compute(0.2, 'USD', NOW)
    expect(r.hoursCovered).toBe(0)
    expect(r.hasEnoughData).toBe(false)
    expect(r.projectedKWhMonth).toBe(0)
    expect(r.measuredSharePct).toBe(0)
    expect(r.windowDays).toBe(30)
  })

  it('projects from covered hours only (missing hours do not dilute)', () => {
    // 20 hours of data at 1 kWh inside the 30-day window. The window is
    // [startHour, endHour), so rows start one hour before the end.
    const rows = []
    for (let i = 1; i <= 20; i++) rows.push(rollup(hourIso(i), 1))
    vi.mocked(hourlyRange).mockReturnValue(rows)

    const r = compute(0.2, 'USD', NOW)
    expect(r.hoursCovered).toBe(20)
    expect(r.kWhInWindow).toBeCloseTo(20, 9)
    expect(r.avgKWhPerHour).toBeCloseTo(1, 9)
    // 1 kWh/h → 24 kWh/day → 720 kWh/month.
    expect(r.projectedKWhPerDay).toBeCloseTo(24, 9)
    expect(r.projectedKWhMonth).toBeCloseTo(720, 6)
    expect(r.projectedCostMonth).toBeCloseTo(144, 6)
    expect(r.hasEnoughData).toBe(true)
  })

  it('computes the 1-sigma band from the per-hour std dev', () => {
    const rows = []
    for (let i = 1; i <= 10; i++) rows.push(rollup(hourIso(i), i === 10 ? 9 : 1))
    vi.mocked(hourlyRange).mockReturnValue(rows)

    const r = compute(0.2, 'USD', NOW)
    expect(r.hoursCovered).toBe(10)
    // Mean 1.8; sum of squares = 9*(1-1.8)^2 + (9-1.8)^2 = 57.6; n-1 = 9.
    const sigmaHour = Math.sqrt(57.6 / 9)
    expect(r.stdDevKWhPerHour).toBeCloseTo(sigmaHour, 9)
    expect(r.lowKWhMonth).toBeLessThan(r.projectedKWhMonth)
    expect(r.highKWhMonth).toBeGreaterThan(r.projectedKWhMonth)
  })

  it('reports the measured (GPU) share of window energy', () => {
    vi.mocked(hourlyRange).mockReturnValue([
      rollup(hourIso(1), 10, 4),
      rollup(hourIso(2), 10, 0)
    ])
    const r = compute(0.2, 'USD', NOW)
    expect(r.measuredKWh).toBeCloseTo(4, 9)
    expect(r.measuredSharePct).toBeCloseTo(20, 9)
  })
})
