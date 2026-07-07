/**
 * Permissive reader model for the Lottie ("bodymovin") JSON we DECOMPOSE back
 * into editable timeline items. Unlike the export schema (which describes
 * exactly what FreeCut emits), the importer reads untrusted, arbitrary Lottie,
 * so every field here is optional and narrowed defensively at read time. It is
 * the structural inverse of `../export/lottie-schema.ts`; a document produced by
 * that exporter satisfies this shape exactly.
 */

export type ReaderVec = number[]

/** A static or animated Lottie property, read loosely. */
export interface ReaderProp {
  a?: number
  k?: unknown
  /** Split-dimension position flag. */
  s?: boolean
  /** Split position sub-tracks (present when `s === true`). */
  x?: ReaderProp
  y?: ReaderProp
}

export interface ReaderKeyframe {
  t?: number
  s?: number[]
  /** Legacy end-value: the value reached at the NEXT keyframe (bodymovin < 5.5). */
  e?: number[]
  h?: number
  // Tangents are per-dimension arrays in modern Lottie but bare numbers in the
  // legacy format, so accept either.
  o?: { x?: number[] | number; y?: number[] | number }
  i?: { x?: number[] | number; y?: number[] | number }
}

export interface ReaderBezier {
  v?: ReaderVec[]
  i?: ReaderVec[]
  o?: ReaderVec[]
  c?: boolean
}

export interface ReaderShapeElement {
  ty?: string
  // geometry (rc / el)
  p?: ReaderProp
  s?: ReaderProp
  r?: ReaderProp
  // path (sh)
  ks?: ReaderProp
  // fill / stroke (fl / st)
  c?: ReaderProp
  o?: ReaderProp
  w?: ReaderProp
  // group (gr)
  it?: ReaderShapeElement[]
  nm?: string
}

export interface ReaderTransform {
  a?: ReaderProp
  p?: ReaderProp
  s?: ReaderProp
  r?: ReaderProp
  o?: ReaderProp
}

export interface ReaderTextDoc {
  t?: string
  f?: string
  s?: number
  j?: number
  fc?: number[]
  lh?: number
  tr?: number
}

export interface ReaderLayer {
  ty?: number
  nm?: string
  ind?: number
  ip?: number
  op?: number
  st?: number
  refId?: string
  w?: number
  h?: number
  ks?: ReaderTransform
  shapes?: ReaderShapeElement[]
  t?: { d?: { k?: Array<{ t?: number; s?: ReaderTextDoc }> } }
  bm?: number
}

export interface ReaderAsset {
  id?: string
  nm?: string
  w?: number
  h?: number
  layers?: ReaderLayer[]
}

export interface ReaderDocument {
  v?: string
  fr?: number
  ip?: number
  op?: number
  w?: number
  h?: number
  nm?: string
  assets?: ReaderAsset[]
  layers?: ReaderLayer[]
}

/**
 * A property is animated when `k` is an array of keyframe OBJECTS. We detect by
 * content rather than the `a` flag: real-world/legacy Lottie files (e.g.
 * bodymovin < 5.5) often omit `a:1` on animated properties, and trusting `a`
 * blindly makes a keyframe-object array look like a static number vector —
 * which then produces `NaN` in the math and hangs the renderer.
 */
export function isAnimatedProp(prop: ReaderProp | undefined): boolean {
  return (
    !!prop &&
    Array.isArray(prop.k) &&
    prop.k.length > 0 &&
    typeof prop.k[0] === 'object' &&
    prop.k[0] !== null
  )
}

/** Read a Lottie property's static scalar value, or undefined if animated/absent. */
export function staticNumber(prop: ReaderProp | undefined): number | undefined {
  if (!prop || isAnimatedProp(prop)) return undefined
  return typeof prop.k === 'number' ? prop.k : undefined
}

/** Read a Lottie property's static vector value, or undefined if animated/absent. */
export function staticVec(prop: ReaderProp | undefined): number[] | undefined {
  if (!prop || isAnimatedProp(prop)) return undefined
  if (!Array.isArray(prop.k)) return undefined
  // Guard against a keyframe-object array slipping through as a "vector".
  return prop.k.every((v) => typeof v === 'number') ? (prop.k as number[]) : undefined
}

/** Read an animated property's keyframe list, or undefined if static/absent. */
export function animatedKeyframes(prop: ReaderProp | undefined): ReaderKeyframe[] | undefined {
  if (!prop || !isAnimatedProp(prop)) return undefined
  return prop.k as ReaderKeyframe[]
}
