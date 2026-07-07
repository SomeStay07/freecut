/**
 * Convert FreeCut keyframe tracks into Lottie animated/static property values.
 *
 * FreeCut interpolates by applying an easing function to the 0-1 segment
 * progress, then linearly interpolating the value (`interpolation.ts`). Lottie
 * encodes the same idea per-segment as bezier tangents `o` (out of the earlier
 * keyframe) and `i` (into the later keyframe), in normalized time × value.
 *
 * The `cubic-bezier` easing maps 1:1 — FreeCut stores it as the same normalized
 * timing curve `{x1,y1,x2,y2}`. Named easings map to representative cubic
 * beziers (FreeCut's are quadratic approximations, so this is close but not bit
 * exact). `hold` → `h:1`. `spring` has overshoot a single bezier can't capture;
 * it falls back to ease-out for now (baking is a follow-up).
 */
import type { Keyframe } from '@/types/keyframe'
import { DEFAULT_BEZIER_POINTS } from '@/types/keyframe'
import type { LottieValue, LottieOffsetKeyframe, LottieSplitPosition } from './lottie-schema'

interface Tangents {
  o: { x: number[]; y: number[] }
  i: { x: number[]; y: number[] }
  hold: boolean
}

function tangents(x1: number, y1: number, x2: number, y2: number): Tangents {
  return { o: { x: [x1], y: [y1] }, i: { x: [x2], y: [y2] }, hold: false }
}

/** Map a keyframe's outgoing easing to Lottie in/out bezier tangents. */
export function easingToTangents(kf: Keyframe): Tangents {
  const type = kf.easingConfig?.type ?? kf.easing

  switch (type) {
    case 'hold':
      return { ...tangents(0, 0, 1, 1), hold: true }
    case 'cubic-bezier': {
      const b = kf.easingConfig?.bezier ?? DEFAULT_BEZIER_POINTS
      return tangents(b.x1, b.y1, b.x2, b.y2)
    }
    case 'spring':
      // TODO(P5): bake spring overshoot into intermediate linear keyframes by
      // sampling `springEasing()`. A single cubic bezier can't represent it.
      return tangents(0, 0, 0.58, 1)
    case 'ease-in':
      return tangents(0.42, 0, 1, 1)
    case 'ease-out':
      return tangents(0, 0, 0.58, 1)
    case 'ease-in-out':
      return tangents(0.42, 0, 0.58, 1)
    case 'linear':
    default:
      // Exact identity timing curve (y = x): control points at 1/3 and 2/3.
      return tangents(1 / 3, 1 / 3, 2 / 3, 2 / 3)
  }
}

/**
 * Build a scalar Lottie property from a keyframe track. `map` transforms each
 * FreeCut value into the Lottie unit (e.g. opacity 0-1 → 0-100). Keyframe times
 * are shifted by `itemFrom` into composition frames.
 */
export function buildScalarProperty(
  keyframes: Keyframe[] | undefined,
  baseValue: number,
  itemFrom: number,
  map: (value: number) => number = (v) => v,
): LottieValue {
  if (!keyframes || keyframes.length === 0) return { a: 0, k: map(baseValue) }
  if (keyframes.length === 1) return { a: 0, k: map(keyframes[0]!.value) }

  const out: LottieOffsetKeyframe[] = []
  for (let idx = 0; idx < keyframes.length; idx++) {
    const kf = keyframes[idx]!
    const entry: LottieOffsetKeyframe = { t: itemFrom + kf.frame, s: [map(kf.value)] }
    // The final keyframe carries no outgoing segment.
    if (idx < keyframes.length - 1) {
      const tan = easingToTangents(kf)
      if (tan.hold) entry.h = 1
      else {
        entry.o = tan.o
        entry.i = tan.i
      }
    }
    out.push(entry)
  }
  return { a: 1, k: out }
}

/**
 * Build a Lottie position property from independent x / y keyframe tracks.
 *
 * FreeCut stores x and y as separate scalar tracks, which maps naturally to
 * Lottie's split-dimension position (`p.s = true`). When neither dimension is
 * animated, a combined static 2D position is emitted instead. `offsetX/offsetY`
 * fold the center-origin → anchor-origin conversion into each value.
 */
export function buildPositionProperty(
  xKeyframes: Keyframe[] | undefined,
  yKeyframes: Keyframe[] | undefined,
  baseX: number,
  baseY: number,
  offsetX: number,
  offsetY: number,
  itemFrom: number,
): LottieValue | LottieSplitPosition {
  const xAnimated = (xKeyframes?.length ?? 0) > 1
  const yAnimated = (yKeyframes?.length ?? 0) > 1

  if (!xAnimated && !yAnimated) {
    const px = offsetX + (xKeyframes?.[0]?.value ?? baseX)
    const py = offsetY + (yKeyframes?.[0]?.value ?? baseY)
    return { a: 0, k: [px, py] }
  }

  return {
    s: true,
    x: buildScalarProperty(xKeyframes, baseX, itemFrom, (v) => offsetX + v),
    y: buildScalarProperty(yKeyframes, baseY, itemFrom, (v) => offsetY + v),
  }
}
