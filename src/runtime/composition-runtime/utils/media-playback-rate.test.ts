import { describe, expect, it } from 'vite-plus/test'
import { clampNativeMediaPlaybackRate, setNativeMediaPlaybackRate } from './media-playback-rate'

describe('native media playback rate', () => {
  it('keeps ordinary rates and clamps unsupported extremes', () => {
    expect(clampNativeMediaPlaybackRate(1.5)).toBe(1.5)
    expect(clampNativeMediaPlaybackRate(18.8489)).toBe(4)
    expect(clampNativeMediaPlaybackRate(0.01)).toBe(0.25)
    expect(clampNativeMediaPlaybackRate(Number.NaN)).toBe(1)
  })

  it('falls back to 1 when a platform rejects the capped rate', () => {
    let assigned = 0
    const element = {
      get playbackRate() {
        return assigned
      },
      set playbackRate(value: number) {
        if (value !== 1) throw new DOMException('unsupported', 'NotSupportedError')
        assigned = value
      },
    }

    expect(setNativeMediaPlaybackRate(element, 18)).toBe(1)
    expect(assigned).toBe(1)
  })
})
