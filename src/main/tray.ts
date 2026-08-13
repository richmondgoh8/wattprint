// Tray widget rendering — state dot + color thresholds.
// The dot buffer is pure (BGRA, premultiplied-alpha-safe: alpha is 255) so
// the byte order and thresholds are unit-testable without Electron.

import { nativeImage, type NativeImage } from 'electron'

export type TrayColorKey = 'good' | 'warn' | 'bad'

/** State color thresholds: green <150 W, amber <400 W, red above. */
export function stateColorKey(watts: number): TrayColorKey {
  return watts < 150 ? 'good' : watts < 400 ? 'warn' : 'bad'
}

const COLORS: Record<TrayColorKey, [number, number, number]> = {
  good: [0x34, 0xd3, 0x99],
  warn: [0xfb, 0xbf, 0x24],
  bad: [0xf8, 0x71, 0x71]
}

const SIZE = 24
const RADIUS = 8

/** A 24px solid-color dot in the state color, as a BGRA bitmap buffer. */
export function stateDotBuffer(watts: number): Buffer {
  const buf = Buffer.alloc(SIZE * SIZE * 4)
  const [r, g, b] = COLORS[stateColorKey(watts)]
  const c = SIZE / 2 - 0.5
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - c
      const dy = y - c
      if (dx * dx + dy * dy <= RADIUS * RADIUS) {
        const i = (y * SIZE + x) * 4
        buf[i] = b
        buf[i + 1] = g
        buf[i + 2] = r
        buf[i + 3] = 255
      }
    }
  }
  return buf
}

export function stateDot(watts: number): NativeImage {
  return nativeImage.createFromBitmap(stateDotBuffer(watts), {
    width: SIZE,
    height: SIZE,
    scaleFactor: 1
  })
}
