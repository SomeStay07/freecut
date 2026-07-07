/**
 * Minimal TypeScript model of the Lottie ("bodymovin") JSON subset that the
 * FreeCut → Lottie exporter emits. This is intentionally NOT a full Lottie
 * schema — it covers exactly the layer/shape/transform features the exporter
 * produces (shape layers with vector geometry, fills, strokes, and animated
 * transforms). It mirrors the conventions the import side reads in
 * `src/infrastructure/lottie/` so exported files round-trip cleanly.
 */

export type Vec2 = [number, number]

/**
 * A Lottie animated/static property value.
 * - static scalar: `{ a: 0, k: 5 }`
 * - static multidimensional: `{ a: 0, k: [x, y] }`
 * - animated: `{ a: 1, k: [keyframe, …] }`
 */
export type LottieValue =
  | { a: 0; k: number }
  | { a: 0; k: number[] }
  | { a: 1; k: LottieOffsetKeyframe[] }

/**
 * One keyframe in an animated property. `s` is the value AT this keyframe;
 * `o`/`i` are the out/in bezier easing tangents for the segment to the next
 * keyframe (normalized [0,1] time × value). `h: 1` marks a hold (step) segment.
 */
export interface LottieOffsetKeyframe {
  t: number
  s: number[]
  i?: { x: number[]; y: number[] }
  o?: { x: number[]; y: number[] }
  h?: 1
}

/** Split-dimension position (`p.s = true`) — separate x / y property tracks. */
export interface LottieSplitPosition {
  s: true
  x: LottieValue
  y: LottieValue
}

/** Layer transform (`ks`). Anchor `a`, position `p`, scale `s` (%), rotation `r`, opacity `o` (%). */
export interface LottieTransform {
  a: LottieValue
  p: LottieValue | LottieSplitPosition
  s: LottieValue
  r: LottieValue
  o: LottieValue
}

/** Raw bezier path value — `v` vertices, `i`/`o` in/out tangents relative to each vertex. */
export interface LottieBezier {
  i: Vec2[]
  o: Vec2[]
  v: Vec2[]
  c: boolean
}

export interface LottieShapePath {
  ty: 'sh'
  ks: { a: 0; k: LottieBezier }
  nm?: string
}

export interface LottieRect {
  ty: 'rc'
  p: LottieValue
  s: LottieValue
  r: LottieValue
  nm?: string
}

export interface LottieEllipse {
  ty: 'el'
  p: LottieValue
  s: LottieValue
  nm?: string
}

export interface LottieFill {
  ty: 'fl'
  c: LottieValue
  o: LottieValue
  /** Fill rule: 1 = non-zero, 2 = even-odd. */
  r?: 1 | 2
  nm?: string
}

export interface LottieStroke {
  ty: 'st'
  c: LottieValue
  o: LottieValue
  w: LottieValue
  /** Line cap: 1 butt, 2 round, 3 square. */
  lc?: 1 | 2 | 3
  /** Line join: 1 miter, 2 round, 3 bevel. */
  lj?: 1 | 2 | 3
  ml?: number
  nm?: string
}

/** Per-group transform. Always the last element of a group's `it` array. */
export interface LottieGroupTransform {
  ty: 'tr'
  a: LottieValue
  p: LottieValue
  s: LottieValue
  r: LottieValue
  o: LottieValue
}

export interface LottieGroup {
  ty: 'gr'
  it: LottieShapeElement[]
  nm?: string
}

export type LottieShapeElement =
  | LottieShapePath
  | LottieRect
  | LottieEllipse
  | LottieFill
  | LottieStroke
  | LottieGroupTransform
  | LottieGroup

/** Shape layer (`ty: 4`). */
export interface LottieShapeLayer {
  ddd: 0
  ind: number
  ty: 4
  nm: string
  sr: 1
  ks: LottieTransform
  ao: 0
  shapes: LottieShapeElement[]
  ip: number
  op: number
  st: number
  bm: number
}

/** Font descriptor referenced by text-layer documents (`f`). */
export interface LottieFont {
  fName: string
  fFamily: string
  fStyle: string
  fWeight?: string
  ascent?: number
}

/** Text-document keyframe (`ty:5` layer's `t.d.k`). Static text uses one entry at t:0. */
export interface LottieTextDocKeyframe {
  t: number
  s: {
    /** font size */
    s: number
    /** font name — matches a `fonts.list[].fName` */
    f: string
    /** the string */
    t: string
    /** justify: 0 left, 1 right, 2 center */
    j: number
    /** tracking */
    tr: number
    /** line height */
    lh: number
    /** baseline shift */
    ls: number
    /** fill color, sRGB 0-1 */
    fc: [number, number, number]
  }
}

export interface LottieTextLayer {
  ddd: 0
  ind: number
  ty: 5
  nm: string
  sr: 1
  ks: LottieTransform
  ao: 0
  t: {
    d: { k: LottieTextDocKeyframe[] }
    p: Record<string, never>
    m: { g: number; a: LottieValue }
    a: unknown[]
  }
  ip: number
  op: number
  st: number
  bm: number
}

export type LottieLayer = LottieShapeLayer | LottieTextLayer

export interface LottieDocument {
  v: string
  fr: number
  ip: number
  op: number
  w: number
  h: number
  nm: string
  ddd: 0
  assets: unknown[]
  fonts?: { list: LottieFont[] }
  layers: LottieLayer[]
  markers: unknown[]
}

/** Bodymovin schema version the exporter targets. */
export const LOTTIE_VERSION = '5.9.6'

/** Identity group transform used to wrap a shape group. */
export function identityGroupTransform(): LottieGroupTransform {
  return {
    ty: 'tr',
    a: { a: 0, k: [0, 0] },
    p: { a: 0, k: [0, 0] },
    s: { a: 0, k: [100, 100] },
    r: { a: 0, k: 0 },
    o: { a: 0, k: 100 },
  }
}
