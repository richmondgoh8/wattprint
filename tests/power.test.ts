import { describe, it, expect } from 'vitest'
import { estimateDiskWatts, estimateNetWatts, estimateRamWatts } from '../src/main/collector.js'

describe('estimateDiskWatts', () => {
  it('returns idle watts at 0 MB/s', () => {
    expect(estimateDiskWatts(0)).toBe(3)
  })
  it('increases with moderate throughput', () => {
    const w = estimateDiskWatts(100)
    expect(w).toBeGreaterThan(3)
    expect(w).toBeLessThan(15)
  })
  it('caps at 15 W for extreme throughput', () => {
    // 3 + 0.01 * 10000 = 103 → capped at 15
    expect(estimateDiskWatts(10000)).toBe(15)
  })
  it('handles negative throughput (counter overflow)', () => {
    expect(estimateDiskWatts(-500)).toBe(3) // idle
  })
  it('handles 900 MB/s burst without absurd wattage', () => {
    const w = estimateDiskWatts(900)
    expect(w).toBeLessThanOrEqual(15)
    expect(w).toBeGreaterThan(3)
  })
  it('returns idle for very small throughput', () => {
    expect(estimateDiskWatts(0.1)).toBeCloseTo(3, 2) // 3 + 0.001 = 3.001
  })
})

describe('estimateNetWatts', () => {
  it('returns 0 at 0 MB/s', () => {
    expect(estimateNetWatts(0)).toBe(0)
  })
  it('increases with throughput', () => {
    const w = estimateNetWatts(100)
    expect(w).toBeGreaterThan(0)
    expect(w).toBeLessThan(12)
  })
  it('caps at 12 W for extreme throughput', () => {
    expect(estimateNetWatts(10000)).toBe(12)
  })
  it('handles negative throughput', () => {
    expect(estimateNetWatts(-100)).toBe(0)
  })
  it('100 MB/s gives realistic NIC power', () => {
    const w = estimateNetWatts(100)
    expect(w).toBeCloseTo(3, 1) // 0.03 * 100 = 3
  })
})

describe('estimateRamWatts', () => {
  it('returns 0 at 0 bytes', () => {
    expect(estimateRamWatts(0)).toBe(0)
  })
  it('estimates 3 W for 8 GB', () => {
    expect(estimateRamWatts(8 * 1024 ** 3)).toBe(3)
  })
  it('estimates 24 W for 64 GB but caps at 20', () => {
    // 3 * (64/8) = 24 → capped at 20
    expect(estimateRamWatts(64 * 1024 ** 3)).toBe(20)
  })
  it('caps at 20 W for very large RAM', () => {
    expect(estimateRamWatts(128 * 1024 ** 3)).toBe(20)
  })
})
