/**
 * Convert a FreeCut `ShapeItem`'s geometry + fill/stroke into a Lottie shape
 * group. Arc-based primitives (rectangle/circle/ellipse) become native Lottie
 * `rc`/`el` (cleaner and more editable in the LottieFiles ecosystem); the
 * polygon family and hearts are parsed from their generated SVG path into raw
 * beziers; pen-tool `path` vertices map directly (they're already the same
 * bezier convention Lottie uses).
 *
 * All geometry is emitted in LOCAL box space (top-left origin, spanning
 * 0..width × 0..height). The owning layer's transform handles placement,
 * rotation, scale, and opacity — see `build-lottie-document.ts`.
 */
import type { ShapeItem } from '@/types/timeline'
import type { MaskVertex } from '@/types/masks'
import {
  makeTriangle,
  makeStar,
  makePolygon,
  makeHeart,
  makeRect,
} from '@/shared/graphics/shapes/shape-generators'
import { translatePath } from '@/shared/graphics/shapes/path-utils'
import { parseCssColorToRgba01 } from './color'
import { svgPathToLottieBezier } from './svg-path'
import {
  identityGroupTransform,
  type LottieBezier,
  type LottieFill,
  type LottieGroup,
  type LottieShapeElement,
  type LottieStroke,
  type Vec2,
} from './lottie-schema'

/** Pen-tool vertices (normalized 0-1 + relative handles) → Lottie bezier. */
function pathVerticesToBezier(vertices: MaskVertex[], width: number, height: number): LottieBezier {
  const scale = (p: [number, number]): Vec2 => [p[0] * width, p[1] * height]
  return {
    v: vertices.map((vx) => scale(vx.position)),
    i: vertices.map((vx) => scale(vx.inHandle)),
    o: vertices.map((vx) => scale(vx.outHandle)),
    c: true,
  }
}

/**
 * Generate a shape's path in local box space, replicating `getShapePath`'s
 * aspect-locked centering (the shape is drawn at its intrinsic size and
 * centered within the box). Only used for the non-arc, non-pen shapes.
 */
function generateLocalPath(shape: ShapeItem, width: number, height: number): string {
  const baseSize = Math.min(width, height)
  const cornerRadius = shape.cornerRadius ?? 0

  let result: { path: string; width: number; height: number }
  switch (shape.shapeType) {
    case 'triangle':
      result = makeTriangle({ length: baseSize, direction: shape.direction ?? 'up', cornerRadius })
      break
    case 'star': {
      const outerRadius = baseSize / 2
      result = makeStar({
        points: shape.points ?? 5,
        outerRadius,
        innerRadius: outerRadius * (shape.innerRadius ?? 0.5),
        cornerRadius,
      })
      break
    }
    case 'polygon':
      result = makePolygon({ points: shape.points ?? 6, radius: baseSize / 2, cornerRadius })
      break
    case 'heart':
      result = makeHeart({ height: baseSize / 1.1 })
      break
    default:
      result = makeRect({ width, height, cornerRadius: 0 })
  }

  const offsetX = (width - result.width) / 2
  const offsetY = (height - result.height) / 2
  return translatePath(result.path, offsetX, offsetY)
}

/** Build the geometry element (native primitive or raw bezier) for a shape. */
function buildGeometry(shape: ShapeItem, width: number, height: number): LottieShapeElement {
  const cornerRadius = shape.cornerRadius ?? 0
  switch (shape.shapeType) {
    case 'rectangle':
      return {
        ty: 'rc',
        nm: 'Rectangle',
        p: { a: 0, k: [width / 2, height / 2] },
        s: { a: 0, k: [width, height] },
        r: { a: 0, k: cornerRadius },
      }
    case 'ellipse':
      return {
        ty: 'el',
        nm: 'Ellipse',
        p: { a: 0, k: [width / 2, height / 2] },
        s: { a: 0, k: [width, height] },
      }
    case 'circle': {
      const diameter = Math.min(width, height)
      return {
        ty: 'el',
        nm: 'Ellipse',
        p: { a: 0, k: [width / 2, height / 2] },
        s: { a: 0, k: [diameter, diameter] },
      }
    }
    case 'path':
      return {
        ty: 'sh',
        nm: 'Path',
        ks: { a: 0, k: pathVerticesToBezier(shape.pathVertices ?? [], width, height) },
      }
    default:
      return {
        ty: 'sh',
        nm: 'Path',
        ks: { a: 0, k: svgPathToLottieBezier(generateLocalPath(shape, width, height)) },
      }
  }
}

function buildFill(color: string): LottieFill {
  const { rgb, a } = parseCssColorToRgba01(color)
  return { ty: 'fl', nm: 'Fill', c: { a: 0, k: rgb }, o: { a: 0, k: a * 100 }, r: 1 }
}

function buildStroke(color: string, widthPx: number): LottieStroke {
  const { rgb, a } = parseCssColorToRgba01(color)
  return {
    ty: 'st',
    nm: 'Stroke',
    c: { a: 0, k: rgb },
    o: { a: 0, k: a * 100 },
    w: { a: 0, k: widthPx },
    lc: 2,
    lj: 2,
    ml: 4,
  }
}

/**
 * Build the full shape group (`gr`) for a shape item: geometry, then fill, then
 * optional stroke, then the group's identity transform.
 */
export function buildShapeGroup(shape: ShapeItem, width: number, height: number): LottieGroup {
  const elements: LottieShapeElement[] = [buildGeometry(shape, width, height)]
  elements.push(buildFill(shape.fillColor))
  if (shape.strokeColor && (shape.strokeWidth ?? 0) > 0) {
    elements.push(buildStroke(shape.strokeColor, shape.strokeWidth!))
  }
  elements.push(identityGroupTransform())
  return { ty: 'gr', nm: shape.label || 'Shape', it: elements }
}
