import { describe, it, expect } from 'vitest'
import { deepPlain } from '../src/renderer/src/lib/wails.js'
import { fmtDate } from '../src/renderer/src/lib/format.js'

// Svelte 5 $state wraps objects in Proxies; shallow-spread copies keep nested
// proxies, which Electron's structured clone rejects ("An object could not be
// cloned."). deepPlain() must produce a clone-safe object.
function deep<T>(target: T): T {
  return new Proxy(target, {
    get(t, k) {
      const v = Reflect.get(t, k)
      return v !== null && typeof v === 'object' ? deep(v) : v
    },
    set(t, k, v) {
      Reflect.set(t, k, v)
      return true
    }
  }) as T
}

describe('deepPlain', () => {
  it('strips nested proxies that structuredClone rejects', () => {
    const proxied = deep({ costPerKWh: 0.17, sleepMode: { whitelist: ['spotify'] } })
    const shallow = { ...proxied }
    expect(() => structuredClone(shallow)).toThrow()

    const plain = deepPlain(shallow)
    expect(plain).toEqual({ costPerKWh: 0.17, sleepMode: { whitelist: ['spotify'] } })
    expect(() => structuredClone(plain)).not.toThrow()
  })

  it('handles null and primitives', () => {
    expect(deepPlain(null)).toBeNull()
    expect(deepPlain('x')).toBe('x')
    expect(deepPlain(42)).toBe(42)
  })
})

describe('fmtDate', () => {
  it('formats a short date and fails safe on garbage', () => {
    expect(fmtDate('2026-08-07T12:00:00Z')).toContain('7')
    expect(fmtDate('not-a-date')).toBe('—')
  })
})
