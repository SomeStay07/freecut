/**
 * Convert an absolute-coordinate SVG path string (the output of FreeCut's shape
 * generators — `src/shared/graphics/shapes/shape-generators.ts`) into a Lottie
 * raw-bezier value (`{ v, i, o, c }`).
 *
 * Only the commands FreeCut's non-arc generators emit are handled: M, L, C, Q,
 * Z (all absolute). Arc-based shapes (rectangle/circle/ellipse use `A`) are
 * emitted as native Lottie primitives (`rc`/`el`) instead, so this parser never
 * needs arc→bezier conversion.
 *
 * Lottie tangents (`i`/`o`) are stored RELATIVE to their vertex, which matches
 * FreeCut's mask-vertex handle convention exactly. Quadratic `Q` segments are
 * elevated to cubic via the standard 2/3 rule.
 */
import type { LottieBezier, Vec2 } from './lottie-schema'

interface WorkingVertex {
  v: Vec2
  i: Vec2
  o: Vec2
}

const EPSILON = 1e-4

function approxEqual(a: Vec2, b: Vec2): boolean {
  return Math.abs(a[0] - b[0]) < EPSILON && Math.abs(a[1] - b[1]) < EPSILON
}

function parseNumbers(segment: string): number[] {
  return (segment.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number)
}

/**
 * Parse an absolute SVG path (M/L/C/Q/Z) into a Lottie bezier. Unsupported
 * commands (H/V/S/T/A) are ignored — callers route arc shapes to native
 * primitives so those never appear here.
 */
export function svgPathToLottieBezier(path: string): LottieBezier {
  const verts: WorkingVertex[] = []
  let closed = false

  const commands = path.match(/[MLHVCSQTAZ][^MLHVCSQTAZ]*/gi) ?? []
  for (const command of commands) {
    const type = command[0]!.toUpperCase()
    const nums = parseNumbers(command.slice(1))

    switch (type) {
      case 'M': {
        // First pair moves; any additional pairs are implicit line-tos.
        for (let k = 0; k + 1 < nums.length; k += 2) {
          verts.push({ v: [nums[k]!, nums[k + 1]!], i: [0, 0], o: [0, 0] })
        }
        break
      }
      case 'L': {
        for (let k = 0; k + 1 < nums.length; k += 2) {
          verts.push({ v: [nums[k]!, nums[k + 1]!], i: [0, 0], o: [0, 0] })
        }
        break
      }
      case 'C': {
        for (let k = 0; k + 5 < nums.length; k += 6) {
          const prev = verts[verts.length - 1]
          if (!prev) continue
          const c1: Vec2 = [nums[k]!, nums[k + 1]!]
          const c2: Vec2 = [nums[k + 2]!, nums[k + 3]!]
          const end: Vec2 = [nums[k + 4]!, nums[k + 5]!]
          prev.o = [c1[0] - prev.v[0], c1[1] - prev.v[1]]
          verts.push({ v: end, i: [c2[0] - end[0], c2[1] - end[1]], o: [0, 0] })
        }
        break
      }
      case 'Q': {
        for (let k = 0; k + 3 < nums.length; k += 4) {
          const prev = verts[verts.length - 1]
          if (!prev) continue
          const q: Vec2 = [nums[k]!, nums[k + 1]!]
          const end: Vec2 = [nums[k + 2]!, nums[k + 3]!]
          // Quadratic → cubic control-point elevation.
          prev.o = [(2 / 3) * (q[0] - prev.v[0]), (2 / 3) * (q[1] - prev.v[1])]
          verts.push({
            v: end,
            i: [(2 / 3) * (q[0] - end[0]), (2 / 3) * (q[1] - end[1])],
            o: [0, 0],
          })
        }
        break
      }
      case 'Z': {
        closed = true
        break
      }
      default:
        break
    }
  }

  // If the path closes back onto its start vertex (e.g. the heart's final cubic
  // ends where the first `M` began), merge them so the closing segment wraps
  // correctly instead of leaving a zero-length duplicate.
  if (closed && verts.length > 1) {
    const first = verts[0]!
    const last = verts[verts.length - 1]!
    if (approxEqual(first.v, last.v)) {
      first.i = last.i
      verts.pop()
    }
  }

  return {
    v: verts.map((vertex) => vertex.v),
    i: verts.map((vertex) => vertex.i),
    o: verts.map((vertex) => vertex.o),
    c: closed,
  }
}
