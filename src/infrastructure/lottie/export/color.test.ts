import { describe, it, expect } from 'vitest'
import { parseCssColorToRgba01 } from './color'

describe('parseCssColorToRgba01', () => {
  it('parses 6-digit hex', () => {
    expect(parseCssColorToRgba01('#ff0000')).toEqual({ rgb: [1, 0, 0], a: 1 })
    expect(parseCssColorToRgba01('#0000FF')).toEqual({ rgb: [0, 0, 1], a: 1 })
  })

  it('parses 3-digit hex as doubled nibbles', () => {
    expect(parseCssColorToRgba01('#f00')).toEqual({ rgb: [1, 0, 0], a: 1 })
  })

  it('parses 8-digit hex with alpha', () => {
    const { rgb, a } = parseCssColorToRgba01('#ff000080')
    expect(rgb).toEqual([1, 0, 0])
    expect(a).toBeCloseTo(0.502, 2)
  })

  it('parses rgb() and rgba()', () => {
    expect(parseCssColorToRgba01('rgb(255, 0, 0)')).toEqual({ rgb: [1, 0, 0], a: 1 })
    const { rgb, a } = parseCssColorToRgba01('rgba(0, 0, 255, 0.5)')
    expect(rgb).toEqual([0, 0, 1])
    expect(a).toBe(0.5)
  })

  it('converts oklch white and black', () => {
    const white = parseCssColorToRgba01('oklch(1 0 0)')
    expect(white.rgb[0]).toBeCloseTo(1, 3)
    expect(white.rgb[1]).toBeCloseTo(1, 3)
    expect(white.rgb[2]).toBeCloseTo(1, 3)

    const black = parseCssColorToRgba01('oklch(0 0 0)')
    expect(black.rgb[0]).toBeCloseTo(0, 3)
    expect(black.rgb[1]).toBeCloseTo(0, 3)
    expect(black.rgb[2]).toBeCloseTo(0, 3)
  })

  it('converts an oklch red into the sRGB red corner', () => {
    // oklch(0.628 0.2577 29.23) is the sRGB primary red.
    const { rgb } = parseCssColorToRgba01('oklch(0.628 0.2577 29.23)')
    expect(rgb[0]).toBeCloseTo(1, 1)
    expect(rgb[1]).toBeCloseTo(0, 1)
    expect(rgb[2]).toBeCloseTo(0, 1)
  })

  it('falls back to black on garbage', () => {
    expect(parseCssColorToRgba01('not-a-color')).toEqual({ rgb: [0, 0, 0], a: 1 })
  })
})
