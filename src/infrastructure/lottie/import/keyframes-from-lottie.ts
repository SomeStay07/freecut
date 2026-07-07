/**
 * Lottie animated/static property → FreeCut keyframe track (the inverse of
 * `../export/keyframes.ts`).
 *
 * Lottie encodes segment easing as per-segment bezier tangents `o` (out of the
 * earlier keyframe) and `i` (into the later keyframe). FreeCut stores the
 * outgoing easing on each keyframe. The mapping is exact for the timing curve:
 * every recovered segment becomes a `cubic-bezier` easing carrying the same
 * control points — the original named easing (`ease-in`, `spring`, …) can't be
 * recovered from the curve, but the curve itself is preserved. The exact
 * identity curve collapses back to `linear`, and `h:1` back to `hold`.
 */
import type { EasingConfig, EasingType, Keyframe } from '@/types/keyframe'
import {
  animatedKeyframes,
  staticNumber,
  type ReaderKeyframe,
  type ReaderProp,
} from './lottie-reader-schema'

const EPS = 1e-3

function approx(a: number, b: number): boolean {
  return Math.abs(a - b) < EPS
}

/** A tangent component is a per-dimension array in modern Lottie, a bare number in legacy. */
function tangentComponent(v: number[] | number | undefined): number | undefined {
  return Array.isArray(v) ? v[0] : v
}

/** Recover the outgoing easing for a Lottie keyframe from its `o`/`i` tangents. */
export function easingFromKeyframe(kf: ReaderKeyframe): {
  easing: EasingType
  easingConfig?: EasingConfig
} {
  if (kf.h === 1) return { easing: 'hold' }
  const x1 = tangentComponent(kf.o?.x)
  const y1 = tangentComponent(kf.o?.y)
  const x2 = tangentComponent(kf.i?.x)
  const y2 = tangentComponent(kf.i?.y)
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    return { easing: 'linear' }
  }
  // The exporter emits the identity timing curve (y = x) as control points at
  // 1/3 and 2/3 — collapse that back to a clean `linear`.
  if (approx(x1, 1 / 3) && approx(y1, 1 / 3) && approx(x2, 2 / 3) && approx(y2, 2 / 3)) {
    return { easing: 'linear' }
  }
  return {
    easing: 'cubic-bezier',
    easingConfig: { type: 'cubic-bezier', bezier: { x1, y1, x2, y2 } },
  }
}

export interface InvertedTrack {
  /** Static base value (first keyframe's value when animated). */
  base: number
  /** Present only when the property is animated (>1 keyframe). */
  keyframes?: Keyframe[]
}

/**
 * Invert one scalar Lottie property (rotation, opacity, or a split-position
 * dimension) into a FreeCut base value + optional keyframe track.
 *
 * `map` converts the Lottie unit into the FreeCut unit (e.g. opacity 0-100 →
 * 0-1, or position `v → v - offset`). Keyframe times shift by `itemFrom` into
 * item-relative frames.
 */
/** Map to the FreeCut unit, coercing a non-finite result to a safe 0 (never NaN). */
function safeMap(raw: number, map: (v: number) => number): number {
  const mapped = map(raw)
  return Number.isFinite(mapped) ? mapped : 0
}

export function invertScalarTrack(
  prop: ReaderProp | undefined,
  opts: { itemFrom: number; makeId: () => string; map?: (v: number) => number },
): InvertedTrack {
  const map = opts.map ?? ((v) => v)
  const kfs = animatedKeyframes(prop)
  if (!kfs || kfs.length === 0) {
    const s = staticNumber(prop)
    return { base: safeMap(s ?? 0, map) }
  }

  // Legacy keyframes (bodymovin < 5.5) carry the segment END in `e` and the
  // final entry has only `t` (no `s`); use the previous `e` as its value.
  let prevEnd: number[] | undefined
  const keyframes: Keyframe[] = kfs.map((kf, idx) => {
    const raw = kf.s?.[0] ?? prevEnd?.[0] ?? 0
    prevEnd = kf.e
    const last = idx === kfs.length - 1
    const easing = last ? { easing: 'linear' as EasingType } : easingFromKeyframe(kf)
    return {
      id: opts.makeId(),
      frame: (kf.t ?? 0) - opts.itemFrom,
      value: safeMap(raw, map),
      easing: easing.easing,
      ...(easing.easingConfig ? { easingConfig: easing.easingConfig } : {}),
    }
  })

  return { base: keyframes[0]!.value, keyframes }
}
