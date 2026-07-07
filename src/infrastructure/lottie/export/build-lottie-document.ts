/**
 * Top-level FreeCut timeline → Lottie document builder (Phase 1: shape items).
 *
 * Emits one Lottie shape layer per `ShapeItem`, converting its transform,
 * opacity, and keyframes (position / rotation / opacity) into the layer's `ks`.
 * Non-shape items and unsupported animated properties are skipped and reported
 * in `warnings` — the exporter is a vector-subset exporter, so surfacing what
 * can't be represented is a first-class part of the result.
 */
import type { ItemKeyframes, AnimatableProperty, Keyframe } from '@/types/keyframe'
import type { ShapeItem, TextItem, TimelineItem } from '@/types/timeline'
import { buildShapeGroup } from './shapes'
import { buildPositionProperty, buildScalarProperty } from './keyframes'
import { buildTextLayer, creatorFontDescriptor } from './text'
import {
  LOTTIE_VERSION,
  type LottieDocument,
  type LottieLayer,
  type LottieTransform,
} from './lottie-schema'

export type LottieExportWarningCode =
  | 'unsupported-item-type'
  | 'missing-size'
  | 'unsupported-animated-property'
  | 'mask-not-exported'
  | 'blend-mode-approximated'

export interface LottieExportWarning {
  code: LottieExportWarningCode
  message: string
  itemId?: string
}

export interface LottieExportOptions {
  /** Composition frame rate. */
  fps: number
  /** Composition width in px. */
  width: number
  /** Composition height in px. */
  height: number
  /** Document name (`nm`). */
  name?: string
  /** Composition out point in frames. Defaults to the latest item end. */
  durationInFrames?: number
  /** Per-item keyframe tracks, keyed by item id. */
  keyframes?: Record<string, ItemKeyframes>
  /** Font name for text layers (must be registered with the player). */
  fontName?: string
}

export interface LottieExportResult {
  document: LottieDocument
  warnings: LottieExportWarning[]
}

/** Lottie blend-mode indices keyed by FreeCut blend-mode name. */
const BLEND_MODE_INDEX: Record<string, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  darken: 4,
  lighten: 5,
  'color-dodge': 6,
  'color-burn': 7,
  'hard-light': 8,
  'soft-light': 9,
  difference: 10,
  exclusion: 11,
  hue: 12,
  saturation: 13,
  color: 14,
  luminosity: 15,
}

const ANIMATED_UNSUPPORTED: AnimatableProperty[] = [
  'width',
  'height',
  'anchorX',
  'anchorY',
  'cornerRadius',
]

function propertyKeyframes(
  itemKeyframes: ItemKeyframes | undefined,
  property: AnimatableProperty,
): Keyframe[] | undefined {
  return itemKeyframes?.properties.find((p) => p.property === property)?.keyframes
}

function isShape(item: TimelineItem): item is ShapeItem {
  return item.type === 'shape'
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/**
 * Build a Lottie document from timeline items (top-to-bottom z-order: the first
 * item becomes the topmost layer). Only shape items are converted in Phase 1.
 */
export function buildLottieDocument(
  items: TimelineItem[],
  options: LottieExportOptions,
): LottieExportResult {
  const { fps, width, height } = options
  const warnings: LottieExportWarning[] = []
  const layers: LottieLayer[] = []

  const centerX = width / 2
  const centerY = height / 2
  const fontName = options.fontName ?? 'Poppins'
  let usesText = false
  let maxEnd = 0

  items.forEach((item, index) => {
    maxEnd = Math.max(maxEnd, item.from + item.durationInFrames)
    const itemKeyframes = options.keyframes?.[item.id]

    if (item.type === 'text') {
      layers.push(
        buildTextLayer(item as TextItem, {
          index: index + 1,
          centerX,
          centerY,
          fontName,
          keyframes: {
            x: propertyKeyframes(itemKeyframes, 'x'),
            y: propertyKeyframes(itemKeyframes, 'y'),
            rotation: propertyKeyframes(itemKeyframes, 'rotation'),
            opacity: propertyKeyframes(itemKeyframes, 'opacity'),
          },
        }),
      )
      usesText = true
      return
    }

    if (!isShape(item)) {
      warnings.push({
        code: 'unsupported-item-type',
        message: `"${item.label}" (${item.type}) can't be represented as vector Lottie and was skipped.`,
        itemId: item.id,
      })
      return
    }

    const transform = item.transform
    let w = transform?.width
    let h = transform?.height
    if (w === undefined || h === undefined) {
      const fallback = Math.min(width, height) * 0.5
      w ??= fallback
      h ??= fallback
      warnings.push({
        code: 'missing-size',
        message: `"${item.label}" has no explicit size; defaulted to ${Math.round(w)}×${Math.round(h)}.`,
        itemId: item.id,
      })
    }

    const anchorX = transform?.anchorX ?? w / 2
    const anchorY = transform?.anchorY ?? h / 2
    const baseX = transform?.x ?? 0
    const baseY = transform?.y ?? 0
    const baseRotation = transform?.rotation ?? 0
    const baseOpacity = transform?.opacity ?? 1

    for (const prop of ANIMATED_UNSUPPORTED) {
      if ((propertyKeyframes(itemKeyframes, prop)?.length ?? 0) > 1) {
        warnings.push({
          code: 'unsupported-animated-property',
          message: `Animated "${prop}" on "${item.label}" is not exported yet (static value used).`,
          itemId: item.id,
        })
      }
    }
    if (item.isMask) {
      warnings.push({
        code: 'mask-not-exported',
        message: `"${item.label}" is a mask; matte export is not implemented yet.`,
        itemId: item.id,
      })
    }

    // Center-origin (FreeCut) → anchor-origin (Lottie): the layer's anchor point
    // sits at (anchorX, anchorY) in local box space and lands at `position`.
    const offsetX = centerX - w / 2 + anchorX
    const offsetY = centerY - h / 2 + anchorY

    const scaleX = transform?.flipHorizontal ? -100 : 100
    const scaleY = transform?.flipVertical ? -100 : 100

    const ks: LottieTransform = {
      a: { a: 0, k: [anchorX, anchorY] },
      p: buildPositionProperty(
        propertyKeyframes(itemKeyframes, 'x'),
        propertyKeyframes(itemKeyframes, 'y'),
        baseX,
        baseY,
        offsetX,
        offsetY,
        item.from,
      ),
      s: { a: 0, k: [scaleX, scaleY] },
      r: buildScalarProperty(propertyKeyframes(itemKeyframes, 'rotation'), baseRotation, item.from),
      o: buildScalarProperty(
        propertyKeyframes(itemKeyframes, 'opacity'),
        baseOpacity,
        item.from,
        (v) => clamp01(v) * 100,
      ),
    }

    let bm = 0
    if (item.blendMode && item.blendMode !== 'normal') {
      bm = BLEND_MODE_INDEX[item.blendMode] ?? 0
      if (BLEND_MODE_INDEX[item.blendMode] === undefined) {
        warnings.push({
          code: 'blend-mode-approximated',
          message: `Blend mode "${item.blendMode}" on "${item.label}" has no Lottie equivalent; used normal.`,
          itemId: item.id,
        })
      }
    }

    layers.push({
      ddd: 0,
      ind: index + 1,
      ty: 4,
      nm: item.label || 'Shape',
      sr: 1,
      ks,
      ao: 0,
      shapes: [buildShapeGroup(item, w, h)],
      ip: item.from,
      op: item.from + item.durationInFrames,
      st: item.from,
      bm,
    })
  })

  const op = options.durationInFrames ?? maxEnd

  const document: LottieDocument = {
    v: LOTTIE_VERSION,
    fr: fps,
    ip: 0,
    op,
    w: width,
    h: height,
    nm: options.name ?? 'FreeCut Export',
    ddd: 0,
    assets: [],
    ...(usesText ? { fonts: { list: [creatorFontDescriptor(fontName)] } } : {}),
    layers,
    markers: [],
  }

  return { document, warnings }
}
