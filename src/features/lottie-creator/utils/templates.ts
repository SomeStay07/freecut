/**
 * Curated native-shape starter documents for the Lottie Creator.
 *
 * Templates are built from the same `ShapeItem` + keyframe model as hand-drawn
 * layers, so a picked template is fully editable (gizmo, properties, presets) —
 * no Lottie→shape importer needed. Each `build()` mints fresh ids so the same
 * template can be dropped in repeatedly.
 */
import type { ShapeItem, ShapeType } from '@/types/timeline'
import type { Keyframe, EasingType, PropertyKeyframes } from '@/types/keyframe'
import type { CreatorLayer } from '@/types/lottie-creation'

export interface CreatorTemplate {
  id: string
  name: string
  width: number
  height: number
  durationInFrames: number
  build: () => CreatorLayer[]
}

interface ShapeSpec {
  shapeType: ShapeType
  x?: number
  y?: number
  width: number
  height: number
  rotation?: number
  opacity?: number
  fillColor: string
  points?: number
  innerRadius?: number
  cornerRadius?: number
}

let kfCounter = 0
function kf(frame: number, value: number, easing: EasingType = 'ease-in-out'): Keyframe {
  kfCounter += 1
  return { id: `tpl-kf-${kfCounter}`, frame, value, easing }
}

function layer(
  spec: ShapeSpec,
  duration: number,
  properties: PropertyKeyframes[] = [],
): CreatorLayer {
  const item: ShapeItem = {
    id: crypto.randomUUID(),
    trackId: 'lottie',
    from: 0,
    durationInFrames: duration,
    label: spec.shapeType.charAt(0).toUpperCase() + spec.shapeType.slice(1),
    type: 'shape',
    shapeType: spec.shapeType,
    fillColor: spec.fillColor,
    ...(spec.points !== undefined ? { points: spec.points } : {}),
    ...(spec.innerRadius !== undefined ? { innerRadius: spec.innerRadius } : {}),
    ...(spec.cornerRadius !== undefined ? { cornerRadius: spec.cornerRadius } : {}),
    transform: {
      x: spec.x ?? 0,
      y: spec.y ?? 0,
      width: spec.width,
      height: spec.height,
      rotation: spec.rotation ?? 0,
      opacity: spec.opacity ?? 1,
    },
  }
  return { item, properties }
}

export const LOTTIE_TEMPLATES: CreatorTemplate[] = [
  {
    id: 'blank',
    name: 'Blank',
    width: 512,
    height: 512,
    durationInFrames: 90,
    build: () => [],
  },
  {
    id: 'pulse',
    name: 'Pulse',
    width: 512,
    height: 512,
    durationInFrames: 90,
    build: () => [
      layer({ shapeType: 'circle', width: 220, height: 220, fillColor: '#6366f1' }, 90, [
        { property: 'opacity', keyframes: [kf(0, 1), kf(45, 0.25), kf(89, 1)] },
      ]),
    ],
  },
  {
    id: 'loader',
    name: 'Loader',
    width: 512,
    height: 512,
    durationInFrames: 60,
    build: () => {
      const dot = (x: number, dip: number) =>
        layer({ shapeType: 'circle', x, width: 90, height: 90, fillColor: '#8b5cf6' }, 60, [
          { property: 'opacity', keyframes: [kf(0, 0.3), kf(dip, 1), kf(59, 0.3)] },
        ])
      // Staggered dips read as a travelling pulse.
      return [dot(-140, 10), dot(0, 25), dot(140, 40)]
    },
  },
  {
    id: 'badge',
    name: 'Star badge',
    width: 512,
    height: 512,
    durationInFrames: 120,
    build: () => {
      const circle = layer(
        { shapeType: 'circle', width: 260, height: 260, fillColor: '#3b82f6' },
        120,
      )
      const star = layer(
        {
          shapeType: 'star',
          width: 180,
          height: 180,
          fillColor: '#f59e0b',
          points: 5,
          innerRadius: 0.5,
        },
        120,
        [{ property: 'rotation', keyframes: [kf(0, 0, 'linear'), kf(119, 360, 'linear')] }],
      )
      return [star, circle] // star renders on top
    },
  },
  {
    id: 'bounce',
    name: 'Bounce',
    width: 512,
    height: 512,
    durationInFrames: 60,
    build: () => [
      layer({ shapeType: 'circle', y: 90, width: 120, height: 120, fillColor: '#10b981' }, 60, [
        {
          property: 'y',
          keyframes: [kf(0, 90, 'ease-out'), kf(30, -90, 'ease-in'), kf(59, 90)],
        },
      ]),
    ],
  },
]
