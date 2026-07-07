import { describe, it, expect } from 'vitest'
import type { Keyframe } from '@/types/keyframe'
import { easingToTangents, buildScalarProperty, buildPositionProperty } from './keyframes'

function kf(frame: number, value: number, partial: Partial<Keyframe> = {}): Keyframe {
  return { id: `k${frame}`, frame, value, easing: 'linear', ...partial }
}

describe('easingToTangents', () => {
  it('maps cubic-bezier 1:1 to in/out tangents', () => {
    const tan = easingToTangents(
      kf(0, 0, {
        easing: 'cubic-bezier',
        easingConfig: { type: 'cubic-bezier', bezier: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 } },
      }),
    )
    expect(tan.o).toEqual({ x: [0.1], y: [0.2] })
    expect(tan.i).toEqual({ x: [0.3], y: [0.4] })
    expect(tan.hold).toBe(false)
  })

  it('represents linear as the identity timing curve', () => {
    const tan = easingToTangents(kf(0, 0, { easing: 'linear' }))
    expect(tan.o.x[0]).toBeCloseTo(1 / 3)
    expect(tan.i.x[0]).toBeCloseTo(2 / 3)
  })

  it('flags hold', () => {
    expect(easingToTangents(kf(0, 0, { easing: 'hold' })).hold).toBe(true)
  })
})

describe('buildScalarProperty', () => {
  it('emits a static value with no keyframes', () => {
    expect(buildScalarProperty(undefined, 42, 0)).toEqual({ a: 0, k: 42 })
  })

  it('emits a static value for a single keyframe', () => {
    expect(buildScalarProperty([kf(0, 7)], 0, 0)).toEqual({ a: 0, k: 7 })
  })

  it('shifts keyframe times by itemFrom and applies the value map', () => {
    const prop = buildScalarProperty([kf(0, 0), kf(10, 1)], 0, 100, (v) => v * 100)
    expect(prop.a).toBe(1)
    if (prop.a !== 1) throw new Error('expected animated')
    expect(prop.k[0]!.t).toBe(100)
    expect(prop.k[0]!.s).toEqual([0])
    expect(prop.k[1]!.t).toBe(110)
    expect(prop.k[1]!.s).toEqual([100])
    // Final keyframe carries no outgoing tangents.
    expect(prop.k[1]!.i).toBeUndefined()
    expect(prop.k[1]!.o).toBeUndefined()
  })

  it('marks hold segments with h:1 and omits tangents', () => {
    const prop = buildScalarProperty([kf(0, 0, { easing: 'hold' }), kf(10, 1)], 0, 0)
    if (prop.a !== 1) throw new Error('expected animated')
    expect(prop.k[0]!.h).toBe(1)
    expect(prop.k[0]!.o).toBeUndefined()
  })
})

describe('buildPositionProperty', () => {
  it('emits a static 2D position when nothing is animated', () => {
    const p = buildPositionProperty(undefined, undefined, 5, 7, 100, 50, 0)
    expect(p).toEqual({ a: 0, k: [105, 57] })
  })

  it('splits into x/y tracks when a dimension is animated, folding in the offset', () => {
    const p = buildPositionProperty([kf(0, 0), kf(10, 20)], undefined, 0, 7, 100, 50, 0)
    expect('s' in p && p.s).toBe(true)
    if (!('s' in p)) throw new Error('expected split position')
    if (p.x.a !== 1) throw new Error('expected animated x')
    expect(p.x.k[0]!.s).toEqual([100]) // 100 + 0
    expect(p.x.k[1]!.s).toEqual([120]) // 100 + 20
    // y stays static at offset + base.
    expect(p.y).toEqual({ a: 0, k: 57 })
  })
})
