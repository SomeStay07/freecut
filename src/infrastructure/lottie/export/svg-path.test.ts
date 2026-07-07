import { describe, it, expect } from 'vitest'
import { svgPathToLottieBezier } from './svg-path'

describe('svgPathToLottieBezier', () => {
  it('parses a closed polygon of straight edges', () => {
    const bezier = svgPathToLottieBezier('M 0 0 L 10 0 L 10 10 Z')
    expect(bezier.v).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ])
    // Straight edges → all tangents are zero.
    expect(bezier.i).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ])
    expect(bezier.o).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ])
    expect(bezier.c).toBe(true)
  })

  it('elevates a quadratic segment to cubic tangents (2/3 rule)', () => {
    const bezier = svgPathToLottieBezier('M 0 0 Q 3 0 6 0')
    expect(bezier.o[0]).toEqual([2, 0]) // (2/3)(3-0)
    expect(bezier.i[1]).toEqual([-2, 0]) // (2/3)(3-6)
    expect(bezier.v).toEqual([
      [0, 0],
      [6, 0],
    ])
  })

  it('keeps relative cubic control points as tangents', () => {
    const bezier = svgPathToLottieBezier('M 0 0 C 1 2 5 6 8 8')
    expect(bezier.o[0]).toEqual([1, 2]) // c1 - start
    expect(bezier.i[1]).toEqual([-3, -2]) // c2 - end
  })

  it('merges the closing vertex when the path returns to its start', () => {
    // A closed loop whose final cubic ends exactly on the start point.
    const bezier = svgPathToLottieBezier('M 0 0 C 1 0 1 1 0 1 C -1 1 -1 0 0 0 Z')
    // The duplicate final vertex is folded into the first.
    expect(bezier.v).toEqual([
      [0, 0],
      [0, 1],
    ])
    expect(bezier.c).toBe(true)
    // The first vertex's in-tangent now comes from the closing segment.
    expect(bezier.i[0]).toEqual([-1, 0]) // c2(-1,0) - end(0,0)
  })
})
