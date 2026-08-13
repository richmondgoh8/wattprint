import { describe, it, expect } from 'vitest'
import { attributeGpuWatts } from '../src/main/collector.js'
import { stateColorKey, stateDotBuffer } from '../src/main/tray.js'
import type { ProcessSample } from '../src/shared/types.js'

function sample(pid: number, name: string, cpuW: number): ProcessSample {
  return { pid, name, cpuW, gpuW: 0, w: cpuW, cpuPct: 10, memoryBytes: 0 }
}

describe('attributeGpuWatts', () => {
  it('attributes gpu watts proportionally to engine share', () => {
    const samples = [sample(1, 'Game', 10), sample(2, 'Chrome', 10)]
    const out = attributeGpuWatts(samples, 100, [
      { name: 'Game', pct: 60 },
      { name: 'Chrome', pct: 30 }
    ])
    const game = out.find((s) => s.pid === 1)
    const chrome = out.find((s) => s.pid === 2)
    expect(game?.gpuW).toBeCloseTo(60, 9)
    expect(chrome?.gpuW).toBeCloseTo(30, 9)
    expect(game?.w).toBeCloseTo(70, 9)
    expect(chrome?.w).toBeCloseTo(40, 9)
    expect(out[0].pid).toBe(1) // re-sorted by total watts
  })

  it('caps the denominator at 100 when engine shares sum below 100', () => {
    const samples = [sample(1, 'Game', 10)]
    const out = attributeGpuWatts(samples, 100, [{ name: 'Game', pct: 50 }])
    expect(out[0].gpuW).toBeCloseTo(50, 9)
  })

  it('does not over-attribute when engine shares exceed 100', () => {
    const samples = [sample(1, 'Game', 10)]
    const out = attributeGpuWatts(samples, 100, [{ name: 'Game', pct: 150 }])
    expect(out[0].gpuW).toBeCloseTo(100, 9)
  })

  it('matches consumers case-insensitively', () => {
    const samples = [sample(1, 'GAME.EXE', 10)]
    const out = attributeGpuWatts(samples, 100, [{ name: 'game.exe', pct: 80 }])
    expect(out[0].gpuW).toBeCloseTo(80, 9)
  })

  it('leaves samples untouched without gpu watts or consumers', () => {
    const samples = [sample(1, 'Game', 10)]
    const out = attributeGpuWatts(samples, null, [{ name: 'Game', pct: 80 }])
    expect(out[0].gpuW).toBe(0)
    expect(out[0].w).toBe(10)
  })
})

describe('tray state dot', () => {
  it('thresholds: green <150 W, amber <400 W, red above', () => {
    expect(stateColorKey(149.9)).toBe('good')
    expect(stateColorKey(150)).toBe('warn')
    expect(stateColorKey(399.9)).toBe('warn')
    expect(stateColorKey(400)).toBe('bad')
  })

  it('writes BGRA bytes so createFromBitmap renders the right colors', () => {
    const center = 24 / 2
    const idx = (center * 24 + center) * 4
    // good (emerald 0x34,0xd3,0x99) → BGRA bytes B=0x99 G=0xd3 R=0x34 A=255
    expect([...stateDotBuffer(50).subarray(idx, idx + 4)]).toEqual([0x99, 0xd3, 0x34, 255])
    // warn (amber 0xfb,0xbf,0x24) → B=0x24 G=0xbf R=0xfb
    expect([...stateDotBuffer(200).subarray(idx, idx + 4)]).toEqual([0x24, 0xbf, 0xfb, 255])
    // bad (red 0xf8,0x71,0x71) → B=0x71 G=0x71 R=0xf8
    expect([...stateDotBuffer(500).subarray(idx, idx + 4)]).toEqual([0x71, 0x71, 0xf8, 255])
  })

  it('leaves pixels outside the dot transparent', () => {
    const buf = stateDotBuffer(50)
    expect(buf[0]).toBe(0)
    expect(buf[3]).toBe(0)
  })
})
