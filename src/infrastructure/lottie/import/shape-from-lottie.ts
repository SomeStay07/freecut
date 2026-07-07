/**
 * Lottie shape layer geometry (`shapes[]`) → FreeCut `ShapeItem` fields
 * (the inverse of `../export/shapes.ts`).
 *
 * The exporter wraps each shape in a single group `gr` holding a geometry
 * element (`rc`/`el`/`sh`), a fill (`fl`), an optional stroke (`st`), and an
 * identity transform (`tr`). Native `rc`/`el` round-trip to `rectangle`/
 * `ellipse` with an exact box; raw beziers (`sh`) become pen-tool `path`
 * vertices. The box size + a path's bounding-box origin flow back out so the
 * caller can rebuild the layer position (`transform-from-lottie.ts`).
 */
import type { MaskVertex } from '@/types/masks'
import type { ShapeItem, ShapeType } from '@/types/timeline'
import { lottieColorToHex } from './color-from-lottie'
import {
  staticNumber,
  staticVec,
  animatedKeyframes,
  type ReaderProp,
  type ReaderShapeElement,
} from './lottie-reader-schema'
import type { LottieImportWarning } from './warnings'

export interface InvertedShape {
  fields: Pick<
    ShapeItem,
    'shapeType' | 'fillColor' | 'strokeColor' | 'strokeWidth' | 'cornerRadius' | 'pathVertices'
  >
  /** Geometry box size, used to place the layer. */
  width: number
  height: number
  /** Path bounding-box origin folded into the box (0 for native primitives). */
  originX: number
  originY: number
}

/** A color that may be static or animated — take the static/first value. */
function firstColorVec(prop: ReaderProp | undefined): number[] | undefined {
  return staticVec(prop) ?? animatedKeyframes(prop)?.[0]?.s
}

function firstScalar(prop: ReaderProp | undefined): number | undefined {
  return staticNumber(prop) ?? animatedKeyframes(prop)?.[0]?.s?.[0]
}

/** Descend into the first group's element list, or use the shapes directly. */
function elementList(shapes: ReaderShapeElement[]): ReaderShapeElement[] {
  const group = shapes.find((el) => el.ty === 'gr')
  return group?.it ?? shapes
}

function invertGeometry(
  els: ReaderShapeElement[],
  warnings: LottieImportWarning[],
  layerName: string,
): {
  shapeType: ShapeType
  width: number
  height: number
  cornerRadius?: number
  pathVertices?: MaskVertex[]
  originX: number
  originY: number
} {
  // Coerce a non-finite/zero dimension to a safe positive size.
  const size = (n: number | undefined): number =>
    typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 100

  const rect = els.find((el) => el.ty === 'rc')
  if (rect) {
    const s = staticVec(rect.s) ?? [100, 100]
    return {
      shapeType: 'rectangle',
      width: size(s[0]),
      height: size(s[1]),
      cornerRadius: staticNumber(rect.r) || undefined,
      originX: 0,
      originY: 0,
    }
  }

  const ellipse = els.find((el) => el.ty === 'el')
  if (ellipse) {
    const s = staticVec(ellipse.s) ?? [100, 100]
    return {
      shapeType: 'ellipse',
      width: size(s[0]),
      height: size(s[1]),
      originX: 0,
      originY: 0,
    }
  }

  const path = els.find((el) => el.ty === 'sh')
  if (path) {
    const bezier = path.ks && path.ks.a !== 1 ? (path.ks.k as unknown) : undefined
    return pathFromBezier(bezier, layerName, warnings)
  }

  warnings.push({
    code: 'unsupported-shape',
    message: `"${layerName}" uses a shape kind that can't be edited; imported as an empty path.`,
    layerName,
  })
  return { shapeType: 'path', width: 1, height: 1, pathVertices: [], originX: 0, originY: 0 }
}

function pathFromBezier(
  bezier: unknown,
  layerName: string,
  warnings: LottieImportWarning[],
): {
  shapeType: 'path'
  width: number
  height: number
  pathVertices: MaskVertex[]
  originX: number
  originY: number
} {
  const b = bezier as { v?: number[][]; i?: number[][]; o?: number[][] } | undefined
  const verts = b?.v ?? []
  if (verts.length === 0) {
    warnings.push({
      code: 'unsupported-shape',
      message: `"${layerName}" has an animated or empty path; imported as an empty path.`,
      layerName,
    })
    return { shapeType: 'path', width: 1, height: 1, pathVertices: [], originX: 0, originY: 0 }
  }

  // Coerce any non-finite coordinate to 0 — a NaN vertex re-exports as a NaN
  // bezier and hangs the renderer.
  const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const v of verts) {
    minX = Math.min(minX, num(v[0]))
    minY = Math.min(minY, num(v[1]))
    maxX = Math.max(maxX, num(v[0]))
    maxY = Math.max(maxY, num(v[1]))
  }
  const width = Math.max(1, num(maxX - minX) || 1)
  const height = Math.max(1, num(maxY - minY) || 1)

  // Normalize vertices into the box (0-1); handles are relative, so only scaled.
  const pathVertices: MaskVertex[] = verts.map((v, idx) => {
    const inH = b?.i?.[idx] ?? [0, 0]
    const outH = b?.o?.[idx] ?? [0, 0]
    return {
      position: [(num(v[0]) - minX) / width, (num(v[1]) - minY) / height],
      inHandle: [num(inH[0]) / width, num(inH[1]) / height],
      outHandle: [num(outH[0]) / width, num(outH[1]) / height],
    }
  })

  return { shapeType: 'path', width, height, pathVertices, originX: minX, originY: minY }
}

/** Invert a shape layer's `shapes` array into `ShapeItem` fields + geometry box. */
export function invertShape(
  shapes: ReaderShapeElement[] | undefined,
  layerName: string,
  warnings: LottieImportWarning[],
): InvertedShape {
  const els = elementList(shapes ?? [])
  const geom = invertGeometry(els, warnings, layerName)

  const fill = els.find((el) => el.ty === 'fl')
  const gradientFill = els.find((el) => el.ty === 'gf')
  let fillColor = '#ffffff'
  if (fill) {
    fillColor = lottieColorToHex(firstColorVec(fill.c), firstScalar(fill.o))
  } else if (gradientFill) {
    warnings.push({
      code: 'gradient-approximated',
      message: `"${layerName}" has a gradient fill; imported as a flat gray (gradients aren't editable yet).`,
      layerName,
    })
    fillColor = '#808080'
  }

  const stroke = els.find((el) => el.ty === 'st')
  let strokeColor: string | undefined
  let strokeWidth: number | undefined
  if (stroke) {
    strokeColor = lottieColorToHex(firstColorVec(stroke.c), firstScalar(stroke.o))
    strokeWidth = firstScalar(stroke.w) || undefined
  }

  return {
    fields: {
      shapeType: geom.shapeType,
      fillColor,
      ...(strokeColor ? { strokeColor } : {}),
      ...(strokeWidth ? { strokeWidth } : {}),
      ...(geom.cornerRadius ? { cornerRadius: geom.cornerRadius } : {}),
      ...(geom.pathVertices ? { pathVertices: geom.pathVertices } : {}),
    },
    width: geom.width,
    height: geom.height,
    originX: geom.originX,
    originY: geom.originY,
  }
}
