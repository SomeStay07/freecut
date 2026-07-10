import { describe, expect, it } from 'vite-plus/test'
import { calculateCompositionFitLayout } from './composition-fit'

describe('calculateCompositionFitLayout', () => {
  it('covers a portrait slot without changing the source aspect ratio', () => {
    const layout = calculateCompositionFitLayout(1920, 1080, 480, 540, 'cover')

    expect(layout.scaleX).toBe(layout.scaleY)
    expect(layout.width / layout.height).toBeCloseTo(16 / 9)
    expect(layout.height).toBe(540)
    expect(layout.width).toBeGreaterThan(480)
    expect(layout.offsetX).toBeLessThan(0)
    expect(layout.offsetY).toBe(0)
  })

  it('keeps legacy fill behavior explicit', () => {
    const layout = calculateCompositionFitLayout(1920, 1080, 480, 540, 'fill')

    expect(layout.width).toBe(480)
    expect(layout.height).toBe(540)
    expect(layout.scaleX).not.toBe(layout.scaleY)
  })
})
