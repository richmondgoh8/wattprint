import { describe, it, expect } from 'vitest'

// Extract the safeDate helper for unit testing — it's the core guard added to
// ipc.ts. The function is duplicated here to avoid importing Electron deps.
function safeDate(iso: string): Date {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${iso}`)
  return d
}

describe('safeDate', () => {
  it('accepts valid ISO strings', () => {
    const d = safeDate('2025-06-15T12:00:00.000Z')
    expect(d.getTime()).toBe(Date.parse('2025-06-15T12:00:00.000Z'))
  })

  it('accepts date-only ISO strings', () => {
    const d = safeDate('2025-06-15')
    expect(d.getFullYear()).toBe(2025)
    expect(d.getMonth()).toBe(5) // June = 5
  })

  it('throws on empty string', () => {
    expect(() => safeDate('')).toThrow('invalid date')
  })

  it('throws on random text', () => {
    expect(() => safeDate('not-a-date')).toThrow('invalid date')
  })

  it('throws on undefined-ish values', () => {
    expect(() => safeDate('undefined')).toThrow('invalid date')
    expect(() => safeDate('null')).toThrow('invalid date')
  })

  it('throws on NaN-generating strings', () => {
    expect(() => safeDate('2025-13-45')).toThrow('invalid date')
  })
})
