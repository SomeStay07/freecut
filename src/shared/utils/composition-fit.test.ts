import { describe, expect, it } from 'vite-plus/test'
import { applyCompositionFraming, calculateCompositionFitLayout } from './composition-fit'

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

  it('scales and pans fitted content within the available overflow', () => {
    const fitted = calculateCompositionFitLayout(1920, 1080, 480, 540, 'cover')
    const framed = applyCompositionFraming(fitted, 480, 540, {
      scale: 1.5,
      offsetX: 1,
      offsetY: -1,
    })

    expect(framed.width).toBe(1440)
    expect(framed.height).toBe(810)
    expect(framed.offsetX).toBe(0)
    expect(framed.offsetY).toBe(-270)
  })
})
