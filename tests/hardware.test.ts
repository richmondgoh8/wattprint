import { describe, it, expect } from 'vitest'
import { resolveCpuReference } from '../src/main/hardware.js'

describe('resolveCpuReference', () => {
  it('maps known SKUs to correct TDPs', () => {
    expect(resolveCpuReference('AMD Ryzen 9 9950X3D').tdpW).toBe(170)
    expect(resolveCpuReference('AMD Ryzen 9 9900X3D').tdpW).toBe(120)
    expect(resolveCpuReference('AMD Ryzen 7 9800X3D').tdpW).toBe(120)
    expect(resolveCpuReference('AMD Ryzen 9 9950X').tdpW).toBe(170)
    expect(resolveCpuReference('AMD Ryzen 9 9900X').tdpW).toBe(120)
    expect(resolveCpuReference('AMD Ryzen 7 9700X').tdpW).toBe(65)
    expect(resolveCpuReference('AMD Ryzen 7 3700X').tdpW).toBe(65)
    expect(resolveCpuReference('AMD Ryzen 5 3600X').tdpW).toBe(95)
    expect(resolveCpuReference('Intel Core i9-14900K').tdpW).toBe(125)
    expect(resolveCpuReference('Intel Core Ultra 7 265K').tdpW).toBe(65)
  })
})
