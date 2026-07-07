/**
 * Shape-layer factory + motion presets for the Lottie Creator (Slice 1).
 *
 * Presets stamp keyframes onto the properties `buildLottieDocument` already
 * exports cleanly (rotation / opacity / x), so every preset survives the round
 * trip to real Lottie. Scale-based presets (pop/grow) are intentionally omitted
 * until the exporter animates width/height → Lottie `s`.
 */
import type { ShapeItem, ShapeType, TextItem } from '@/types/timeline'
import type { PropertyKeyframes } from '@/types/keyframe'

export type PresetKind = 'spin' | 'fadeIn' | 'slideIn' | 'pulse'

const PALETTE = [
  '#6366f1',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#ef4444',
  '#8b5cf6',
  '#14b8a6',
]

export function pickColor(index: number): string {
  return PALETTE[index % PALETTE.length]!
}

const SHAPE_LABEL: Record<ShapeType, string> = {
  rectangle: 'Rectangle',
  circle: 'Circle',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  star: 'Star',
  polygon: 'Polygon',
  heart: 'Heart',
  path: 'Path',
}

/** Create a centered shape item sized to ~40% of the canvas. */
export function createShapeLayerItem(
  shapeType: ShapeType,
  opts: { index: number; width: number; height: number; durationInFrames: number },
): ShapeItem {
  const size = Math.round(Math.min(opts.width, opts.height) * 0.4)
  const base: ShapeItem = {
    id: crypto.randomUUID(),
    trackId: 'lottie',
    from: 0,
    durationInFrames: opts.durationInFrames,
    label: `${SHAPE_LABEL[shapeType]} ${opts.index + 1}`,
    type: 'shape',
    shapeType,
    fillColor: pickColor(opts.index),
    transform: { x: 0, y: 0, width: size, height: size },
  }
  if (shapeType === 'star') return { ...base, points: 5, innerRadius: 0.5 }
  if (shapeType === 'polygon') return { ...base, points: 6 }
  return base
}

/**
 * Build the keyframe track a preset animates. Merged into a layer by property,
 * so combining (e.g. spin + fadeIn) is additive.
 */
export function buildPresetKeyframes(
  preset: PresetKind,
  item: ShapeItem | TextItem,
  durationInFrames: number,
): PropertyKeyframes {
  const end = Math.max(1, durationInFrames - 1)
  const baseRotation = item.transform?.rotation ?? 0
  const baseOpacity = item.transform?.opacity ?? 1
  const baseX = item.transform?.x ?? 0
  const width = item.transform?.width ?? 200

  switch (preset) {
    case 'spin':
      return {
        property: 'rotation',
        keyframes: [
          { id: 'rot-0', frame: 0, value: baseRotation, easing: 'linear' },
          { id: 'rot-1', frame: end, value: baseRotation + 360, easing: 'linear' },
        ],
      }
    case 'fadeIn': {
      const at = Math.min(15, end)
      return {
        property: 'opacity',
        keyframes: [
          { id: 'op-0', frame: 0, value: 0, easing: 'ease-out' },
          { id: 'op-1', frame: at, value: baseOpacity, easing: 'linear' },
        ],
      }
    }
    case 'slideIn': {
      const at = Math.min(20, end)
      return {
        property: 'x',
        keyframes: [
          { id: 'x-0', frame: 0, value: baseX - width * 1.5, easing: 'ease-out' },
          { id: 'x-1', frame: at, value: baseX, easing: 'linear' },
        ],
      }
    }
    case 'pulse': {
      const mid = Math.round(end / 2)
      return {
        property: 'opacity',
        keyframes: [
          { id: 'op-0', frame: 0, value: baseOpacity, easing: 'ease-in-out' },
          { id: 'op-1', frame: mid, value: 0.3, easing: 'ease-in-out' },
          { id: 'op-2', frame: end, value: baseOpacity, easing: 'ease-in-out' },
        ],
      }
    }
  }
}
