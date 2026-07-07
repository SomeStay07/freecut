/**
 * Lottie layer transform (`ks`) → FreeCut item transform + keyframe tracks
 * (the inverse of the `ks` assembly in `../export/build-lottie-document.ts`).
 *
 * The center-origin ↔ anchor-origin conversion is folded into `offsetX/offsetY`
 * supplied by the caller: `freecut_value = lottie_value - offset`. Scale is only
 * representable as horizontal/vertical flips in FreeCut, so non-±100 scale is
 * approximated (flip sign only) with a warning. Animated anchor/scale can't be
 * represented and are reported.
 */
import type { TransformProperties } from '@/types/transform'
import type { Keyframe, PropertyKeyframes } from '@/types/keyframe'
import { invertScalarTrack, easingFromKeyframe } from './keyframes-from-lottie'
import { animatedKeyframes, staticVec, type ReaderTransform } from './lottie-reader-schema'
import type { LottieImportWarning } from './warnings'

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

export interface TransformInversionOptions {
  ks: ReaderTransform
  /** `freecut_x = lottie_x - offsetX`. */
  offsetX: number
  offsetY: number
  /** Box size + anchor to write onto the transform (from the geometry). */
  width?: number
  height?: number
  anchorX?: number
  anchorY?: number
  itemFrom: number
  makeId: () => string
  warnings: LottieImportWarning[]
  layerName: string
}

export interface InvertedTransform {
  transform: TransformProperties
  /** x / y / rotation / opacity keyframe tracks (only the animated ones). */
  properties: PropertyKeyframes[]
}

export function invertTransform(opts: TransformInversionOptions): InvertedTransform {
  const { ks, offsetX, offsetY, itemFrom, makeId, warnings, layerName } = opts
  const transform: TransformProperties = {}
  const properties: PropertyKeyframes[] = []

  if (opts.width !== undefined) transform.width = opts.width
  if (opts.height !== undefined) transform.height = opts.height
  if (opts.anchorX !== undefined) transform.anchorX = opts.anchorX
  if (opts.anchorY !== undefined) transform.anchorY = opts.anchorY

  // Scale → flip. FreeCut has no scale%, so only the sign is representable.
  const scale = staticVec(ks.s)
  if (scale) {
    if ((scale[0] ?? 100) < 0) transform.flipHorizontal = true
    if ((scale[1] ?? 100) < 0) transform.flipVertical = true
    const magX = Math.abs(scale[0] ?? 100)
    const magY = Math.abs(scale[1] ?? 100)
    if (Math.abs(magX - 100) > 0.5 || Math.abs(magY - 100) > 0.5) {
      warnings.push({
        code: 'scale-approximated',
        message: `"${layerName}" has non-100% scale (${magX}×${magY}); flip preserved, magnitude dropped.`,
      })
    }
  } else if (ks.s && ks.s.a === 1) {
    warnings.push({
      code: 'animated-transform-approximated',
      message: `"${layerName}" animates scale, which isn't editable; used its first value.`,
    })
    const first = animatedKeyframes(ks.s)?.[0]?.s
    if (first) {
      if ((first[0] ?? 100) < 0) transform.flipHorizontal = true
      if ((first[1] ?? 100) < 0) transform.flipVertical = true
    }
  }

  if (ks.a && ks.a.a === 1) {
    warnings.push({
      code: 'animated-transform-approximated',
      message: `"${layerName}" animates its anchor, which isn't editable; used its first value.`,
    })
  }

  // Rotation.
  const rot = invertScalarTrack(ks.r, { itemFrom, makeId })
  transform.rotation = rot.base
  if (rot.keyframes) properties.push({ property: 'rotation', keyframes: rot.keyframes })

  // Opacity (Lottie 0-100 → FreeCut 0-1).
  const op = invertScalarTrack(ks.o, { itemFrom, makeId, map: (v) => clamp01(v / 100) })
  transform.opacity = ks.o ? op.base : 1
  if (op.keyframes) properties.push({ property: 'opacity', keyframes: op.keyframes })

  // Position.
  const p = ks.p
  if (p?.s === true) {
    // Split-dimension position — the exporter's animated-position shape.
    const xr = invertScalarTrack(p.x, { itemFrom, makeId, map: (v) => v - offsetX })
    const yr = invertScalarTrack(p.y, { itemFrom, makeId, map: (v) => v - offsetY })
    transform.x = xr.base
    transform.y = yr.base
    if (xr.keyframes) properties.push({ property: 'x', keyframes: xr.keyframes })
    if (yr.keyframes) properties.push({ property: 'y', keyframes: yr.keyframes })
  } else if (animatedKeyframes(p)) {
    // Unified animated 2-D position. Detected by content so legacy files (no
    // `a:1` flag) are handled; split into x/y tracks, carrying legacy `e`/
    // missing-`s` end-values forward. The shared per-keyframe easing is a
    // best-effort approximation.
    const kfs = animatedKeyframes(p) ?? []
    const buildDim = (dim: 0 | 1, offset: number): Keyframe[] => {
      let prevEnd: number[] | undefined
      return kfs.map((kf, idx) => {
        const raw = kf.s?.[dim] ?? prevEnd?.[dim] ?? 0
        prevEnd = kf.e
        const last = idx === kfs.length - 1
        const e = last ? { easing: 'linear' as const } : easingFromKeyframe(kf)
        const value = raw - offset
        return {
          id: makeId(),
          frame: (kf.t ?? 0) - itemFrom,
          value: Number.isFinite(value) ? value : 0,
          easing: e.easing,
          ...(e.easingConfig ? { easingConfig: e.easingConfig } : {}),
        }
      })
    }
    const xk = buildDim(0, offsetX)
    const yk = buildDim(1, offsetY)
    transform.x = xk[0]?.value ?? 0
    transform.y = yk[0]?.value ?? 0
    if (xk.length) properties.push({ property: 'x', keyframes: xk })
    if (yk.length) properties.push({ property: 'y', keyframes: yk })
  } else {
    // Static combined position.
    const vec = staticVec(p)
    transform.x = (vec?.[0] ?? offsetX) - offsetX
    transform.y = (vec?.[1] ?? offsetY) - offsetY
  }

  // Final guard: a non-finite transform value hangs the Lottie renderer (thorvg
  // loops on NaN geometry), so coerce anything malformed to a safe default.
  const finite = (n: number | undefined, fallback: number): number =>
    n !== undefined && Number.isFinite(n) ? n : fallback
  transform.x = finite(transform.x, 0)
  transform.y = finite(transform.y, 0)
  if (transform.width !== undefined) transform.width = finite(transform.width, 1)
  if (transform.height !== undefined) transform.height = finite(transform.height, 1)
  if (transform.anchorX !== undefined) transform.anchorX = finite(transform.anchorX, 0)
  if (transform.anchorY !== undefined) transform.anchorY = finite(transform.anchorY, 0)
  transform.rotation = finite(transform.rotation, 0)
  transform.opacity = finite(transform.opacity, 1)

  return { transform, properties }
}
