import { describe, it, expect } from 'vitest'
import { fmtW, fmtKWh, fmtEnergy, fmtMoney, fmtBytes, fmtDuration } from '../src/renderer/src/lib/format.js'

describe('fmtW', () => {
  it('formats watts and kW', () => {
    expect(fmtW(12.34)).toBe('12.3 W')
    expect(fmtW(1000)).toBe('1.00 kW')
  })
  it('returns em dash for null, NaN, negative', () => {
    expect(fmtW(null)).toBe('—')
    expect(fmtW(NaN)).toBe('—')
    expect(fmtW(-1)).toBe('—')
  })
})

describe('fmtKWh / fmtEnergy', () => {
  it('shows MWh above 1000 kWh', () => {
    expect(fmtKWh(1500)).toBe('1.50 MWh')
  })
  it('fmtEnergy falls back to Wh below 1 kWh', () => {
    expect(fmtEnergy(0.5)).toBe('500.0 Wh')
    expect(fmtEnergy(1.5)).toBe('1.50 kWh')
  })
})

describe('fmtMoney', () => {
  it('uses Intl with the requested currency', () => {
    expect(fmtMoney(12.5, 'USD')).toBe('$12.50')
  })
  it('never throws for unusual currency codes', () => {
    // ICU may render unknown codes either way; what matters is no crash.
    expect(fmtMoney(12.5, 'ZZZ')).toContain('12.50')
  })
})

describe('fmtBytes', () => {
  it('scales through B..TB', () => {
    expect(fmtBytes(500)).toBe('500 B')
    expect(fmtBytes(1536)).toBe('1.5 KB')
    expect(fmtBytes(1024 ** 2)).toBe('1.0 MB')
    expect(fmtBytes(1024 ** 3)).toBe('1.0 GB')
    expect(fmtBytes(1024 ** 4)).toBe('1.0 TB')
  })
  it('returns em dash for null and non-positive', () => {
    expect(fmtBytes(null)).toBe('—')
    expect(fmtBytes(0)).toBe('—')
    expect(fmtBytes(-5)).toBe('—')
  })
})

describe('fmtDuration', () => {
  it('formats minutes, hours, and days', () => {
    expect(fmtDuration(0.5)).toBe('30 min')
    expect(fmtDuration(24)).toBe('24.0 h')
    expect(fmtDuration(72)).toBe('3.0 d')
  })
})
