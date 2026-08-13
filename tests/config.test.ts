import { describe, it, expect } from 'vitest'

// Test the updateSettings PATCH logic in isolation. The actual electron-store
// dependency is mocked — we only validate the field-level merge rules.

interface Settings {
  costPerKWh: number
  currency: string
  sampleIntervalSeconds: number
  startOnLogin: boolean
  closeToTray: boolean
  theme: string
  sleepMode: { whitelist: string[] }
}

const DEFAULTS: Settings = {
  costPerKWh: 0.17,
  currency: 'USD',
  sampleIntervalSeconds: 1,
  startOnLogin: false,
  closeToTray: true,
  theme: 'system',
  sleepMode: { whitelist: ['spotify', 'spotify web helper', 'chrome'] }
}

/** Mirror of config.ts updateSettings logic without the store dependency. */
function applyPatch(cur: Settings, patch: Partial<Settings>): Settings {
  const next: Settings = { ...cur }
  if (typeof patch.costPerKWh === 'number' && patch.costPerKWh >= 0) next.costPerKWh = patch.costPerKWh
  if (typeof patch.currency === 'string' && patch.currency) next.currency = patch.currency
  if (typeof patch.sampleIntervalSeconds === 'number' && patch.sampleIntervalSeconds > 0)
    next.sampleIntervalSeconds = patch.sampleIntervalSeconds
  if (typeof patch.theme === 'string' && patch.theme) next.theme = patch.theme
  if (typeof patch.startOnLogin === 'boolean') next.startOnLogin = patch.startOnLogin
  if (typeof patch.closeToTray === 'boolean') next.closeToTray = patch.closeToTray
  if (patch.sleepMode && typeof patch.sleepMode === 'object') {
    const whitelist = Array.isArray(patch.sleepMode.whitelist)
      ? patch.sleepMode.whitelist.map((w) => String(w).toLowerCase()).filter((w) => w.length > 0)
      : next.sleepMode.whitelist
    next.sleepMode = { whitelist }
  }
  return next
}

describe('updateSettings PATCH logic', () => {
  it('applies a single field without resetting others', () => {
    const result = applyPatch(DEFAULTS, { costPerKWh: 0.25 })
    expect(result.costPerKWh).toBe(0.25)
    expect(result.currency).toBe('USD')
    expect(result.theme).toBe('system')
  })

  it('rejects negative costPerKWh', () => {
    const result = applyPatch(DEFAULTS, { costPerKWh: -5 })
    expect(result.costPerKWh).toBe(0.17) // unchanged
  })

  it('accepts zero costPerKWh', () => {
    const result = applyPatch(DEFAULTS, { costPerKWh: 0 })
    expect(result.costPerKWh).toBe(0)
  })

  it('rejects empty currency string', () => {
    const result = applyPatch(DEFAULTS, { currency: '' })
    expect(result.currency).toBe('USD') // unchanged
  })

  it('rejects non-positive sampleIntervalSeconds', () => {
    const result = applyPatch(DEFAULTS, { sampleIntervalSeconds: 0 })
    expect(result.sampleIntervalSeconds).toBe(1) // unchanged

    const result2 = applyPatch(DEFAULTS, { sampleIntervalSeconds: -5 })
    expect(result2.sampleIntervalSeconds).toBe(1) // unchanged
  })

  it('accepts valid sampleIntervalSeconds', () => {
    const result = applyPatch(DEFAULTS, { sampleIntervalSeconds: 10 })
    expect(result.sampleIntervalSeconds).toBe(10)
  })

  it('toggles startOnLogin boolean', () => {
    const result = applyPatch(DEFAULTS, { startOnLogin: true })
    expect(result.startOnLogin).toBe(true)
  })

  it('normalizes sleepMode whitelist to lowercase and filters empties', () => {
    const result = applyPatch(DEFAULTS, {
      sleepMode: { whitelist: ['Spotify', '', 'Chrome'] }
    })
    expect(result.sleepMode.whitelist).toEqual(['spotify', 'chrome'])
  })

  it('preserves existing whitelist when patch has no whitelist array', () => {
    const result = applyPatch(DEFAULTS, { sleepMode: {} as Settings['sleepMode'] })
    expect(result.sleepMode.whitelist).toEqual(DEFAULTS.sleepMode.whitelist)
  })

  it('applies multiple fields at once', () => {
    const result = applyPatch(DEFAULTS, {
      costPerKWh: 0.30,
      currency: 'EUR',
      theme: 'dark',
      closeToTray: false
    })
    expect(result.costPerKWh).toBe(0.30)
    expect(result.currency).toBe('EUR')
    expect(result.theme).toBe('dark')
    expect(result.closeToTray).toBe(false)
    expect(result.startOnLogin).toBe(false) // untouched
  })
})
