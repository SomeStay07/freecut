import type {
  AnimatableProperty,
  EasingConfig,
  EasingType,
  ItemKeyframes,
  Keyframe,
  PropertyKeyframes,
} from '@/types/keyframe'
import type {
  MotionLayoutCategory,
  MotionLayoutEasing,
  MotionLayoutFrameAspect,
  MotionLayoutParameterKey,
  MotionLayoutSettings,
  MotionLayoutTemplateId,
} from '@/types/motion-layout'
import { interpolatePropertyValue } from '../deps/keyframes-contract'

export interface MotionLayoutTemplateDefinition {
  id: MotionLayoutTemplateId
  version: number
  category: MotionLayoutCategory
  labelKey: string
  descriptionKey: string
  preferredSlots: number
  minSlots: number
  maxSlots: number
  defaultDurationSeconds: number
  parameterKeys: MotionLayoutParameterKey[]
  defaults: MotionLayoutSettings
}

export interface MotionLayoutResolvedSlot {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  /** Opaque black treatment used for spatial depth; never reveals cards behind this one. */
  depthDim: number
  cornerRadius: number
}

export interface MotionLayoutSlotPlan {
  itemId: string
  keyframes: ItemKeyframes
}

export interface MotionLayoutPlan {
  durationInFrames: number
  slots: MotionLayoutSlotPlan[]
}

export interface BuildMotionLayoutPlanInput {
  templateId: MotionLayoutTemplateId
  slotIds: string[]
  width: number
  height: number
  fps: number
  settings: MotionLayoutSettings
}

export const MOTION_LAYOUT_FRAME_ASPECTS: readonly MotionLayoutFrameAspect[] = [
  '16:9',
  '4:3',
  '1:1',
  '4:5',
  '9:16',
]

const FRAME_RATIO_BY_ASPECT: Record<MotionLayoutFrameAspect, number> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '4:5': 4 / 5,
  '9:16': 9 / 16,
}

function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

export function resolveMotionLayoutFrameSize(
  referenceWidth: number,
  referenceHeight: number,
  aspect: MotionLayoutFrameAspect,
): { width: number; height: number } {
  const safeWidth = Math.max(2, referenceWidth)
  const safeHeight = Math.max(2, referenceHeight)
  const targetRatio = FRAME_RATIO_BY_ASPECT[aspect]
  if (targetRatio >= safeWidth / safeHeight) {
    return {
      width: evenDimension(safeWidth),
      height: evenDimension(safeWidth / targetRatio),
    }
  }
  return {
    width: evenDimension(safeHeight * targetRatio),
    height: evenDimension(safeHeight),
  }
}

export function closestMotionLayoutFrameAspect(
  width: number,
  height: number,
): MotionLayoutFrameAspect {
  const ratio = width / Math.max(1, height)
  return MOTION_LAYOUT_FRAME_ASPECTS.reduce((closest, candidate) =>
    Math.abs(FRAME_RATIO_BY_ASPECT[candidate] - ratio) <
    Math.abs(FRAME_RATIO_BY_ASPECT[closest] - ratio)
      ? candidate
      : closest,
  )
}

type MotionValues = MotionLayoutResolvedSlot

export function motionLayoutDepthEffectId(itemId: string): string {
  return `motion-layout-depth:${itemId}`
}

export function motionLayoutDepthProperty(itemId: string): AnimatableProperty {
  return `effect:gpu-brightness:${motionLayoutDepthEffectId(itemId)}:amount`
}

interface MotionSnapshot {
  at: number
  values: Partial<MotionValues>
  easing?: MotionLayoutEasing | 'hold' | 'linear'
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const BASE_SETTINGS: MotionLayoutSettings = {
  durationSeconds: 8,
  backgroundColor: '#101014',
  padding: 0.06,
  gap: 0.03,
  cornerRadius: 0.03,
  easing: 'smooth',
  direction: 'horizontal',
  railSize: 0.26,
  sideScale: 0.82,
  cardInset: 0.04,
  spacing: 0,
  backgroundDim: 0.45,
  zoom: 0.45,
  tilt: -0.06,
  trailLength: 0.72,
  staggerOverlap: 0.6,
  edgeAngle: -20,
  strips: 7,
  hold: 0.33,
  perspective: 0.18,
  ringTilt: -0.28,
  ringOpening: 0.55,
  ringSize: 0.8,
  cardSize: 0.21,
  backFade: 0.7,
}

const COMMON_PARAMETERS: MotionLayoutParameterKey[] = [
  'durationSeconds',
  'backgroundColor',
  'padding',
  'cornerRadius',
  'easing',
]

function template(
  definition: Omit<MotionLayoutTemplateDefinition, 'version' | 'defaults'> & {
    defaults?: Partial<MotionLayoutSettings>
  },
): MotionLayoutTemplateDefinition {
  return {
    ...definition,
    version: 1,
    defaults: {
      ...BASE_SETTINGS,
      durationSeconds: definition.defaultDurationSeconds,
      ...definition.defaults,
    },
  }
}

export const MOTION_LAYOUT_TEMPLATES: MotionLayoutTemplateDefinition[] = [
  template({
    id: 'grid-reveal',
    category: 'grid',
    labelKey: 'timeline.motionLayout.templates.gridReveal.label',
    descriptionKey: 'timeline.motionLayout.templates.gridReveal.description',
    preferredSlots: 4,
    minSlots: 2,
    maxSlots: 12,
    defaultDurationSeconds: 6,
    parameterKeys: [...COMMON_PARAMETERS, 'gap'],
  }),
  template({
    id: 'center-stage',
    category: 'spotlight',
    labelKey: 'timeline.motionLayout.templates.centerStage.label',
    descriptionKey: 'timeline.motionLayout.templates.centerStage.description',
    preferredSlots: 3,
    minSlots: 2,
    maxSlots: 12,
    defaultDurationSeconds: 7,
    parameterKeys: COMMON_PARAMETERS,
  }),
  template({
    id: 'focus-shift',
    category: 'spotlight',
    labelKey: 'timeline.motionLayout.templates.focusShift.label',
    descriptionKey: 'timeline.motionLayout.templates.focusShift.description',
    preferredSlots: 4,
    minSlots: 2,
    maxSlots: 8,
    defaultDurationSeconds: 10,
    parameterKeys: [...COMMON_PARAMETERS, 'gap', 'railSize'],
  }),
  template({
    id: 'stack-slide',
    category: 'stack',
    labelKey: 'timeline.motionLayout.templates.stackSlide.label',
    descriptionKey: 'timeline.motionLayout.templates.stackSlide.description',
    preferredSlots: 4,
    minSlots: 2,
    maxSlots: 10,
    defaultDurationSeconds: 8,
    parameterKeys: [...COMMON_PARAMETERS, 'cardInset'],
  }),
  template({
    id: 'position-dance',
    category: 'stack',
    labelKey: 'timeline.motionLayout.templates.positionDance.label',
    descriptionKey: 'timeline.motionLayout.templates.positionDance.description',
    preferredSlots: 6,
    minSlots: 2,
    maxSlots: 12,
    defaultDurationSeconds: 4,
    parameterKeys: [...COMMON_PARAMETERS, 'spacing'],
    defaults: { cornerRadius: 0.04 },
  }),
  template({
    id: 'carousel-flow',
    category: 'carousel',
    labelKey: 'timeline.motionLayout.templates.carouselFlow.label',
    descriptionKey: 'timeline.motionLayout.templates.carouselFlow.description',
    preferredSlots: 5,
    minSlots: 3,
    maxSlots: 12,
    defaultDurationSeconds: 10,
    parameterKeys: [...COMMON_PARAMETERS, 'gap', 'sideScale', 'direction'],
  }),
  template({
    id: 'spotlight-zoom',
    category: 'spotlight',
    labelKey: 'timeline.motionLayout.templates.spotlightZoom.label',
    descriptionKey: 'timeline.motionLayout.templates.spotlightZoom.description',
    preferredSlots: 4,
    minSlots: 2,
    maxSlots: 8,
    defaultDurationSeconds: 12,
    parameterKeys: [...COMMON_PARAMETERS, 'gap', 'backgroundDim'],
  }),
  template({
    id: 'deck-peel',
    category: 'spotlight',
    labelKey: 'timeline.motionLayout.templates.deckPeel.label',
    descriptionKey: 'timeline.motionLayout.templates.deckPeel.description',
    preferredSlots: 4,
    minSlots: 2,
    maxSlots: 10,
    defaultDurationSeconds: 9,
    parameterKeys: [...COMMON_PARAMETERS, 'cardInset', 'hold'],
  }),
  template({
    id: 'zoom-parallax',
    category: 'spotlight',
    labelKey: 'timeline.motionLayout.templates.zoomParallax.label',
    descriptionKey: 'timeline.motionLayout.templates.zoomParallax.description',
    preferredSlots: 3,
    minSlots: 2,
    maxSlots: 8,
    defaultDurationSeconds: 9,
    parameterKeys: [...COMMON_PARAMETERS, 'zoom', 'hold'],
  }),
  template({
    id: 'pop-grid',
    category: 'grid',
    labelKey: 'timeline.motionLayout.templates.popGrid.label',
    descriptionKey: 'timeline.motionLayout.templates.popGrid.description',
    preferredSlots: 6,
    minSlots: 2,
    maxSlots: 12,
    defaultDurationSeconds: 8,
    parameterKeys: [...COMMON_PARAMETERS, 'gap', 'hold'],
  }),
  template({
    id: 'ticker-loop',
    category: 'carousel',
    labelKey: 'timeline.motionLayout.templates.tickerLoop.label',
    descriptionKey: 'timeline.motionLayout.templates.tickerLoop.description',
    preferredSlots: 12,
    minSlots: 4,
    maxSlots: 16,
    defaultDurationSeconds: 12,
    parameterKeys: [
      'durationSeconds',
      'backgroundColor',
      'cornerRadius',
      'gap',
      'zoom',
      'tilt',
      'direction',
    ],
  }),
  template({
    id: 'column-drift',
    category: 'carousel',
    labelKey: 'timeline.motionLayout.templates.columnDrift.label',
    descriptionKey: 'timeline.motionLayout.templates.columnDrift.description',
    preferredSlots: 6,
    minSlots: 3,
    maxSlots: 15,
    defaultDurationSeconds: 12,
    parameterKeys: [...COMMON_PARAMETERS, 'gap', 'direction'],
  }),
  template({
    id: 'image-trail',
    category: 'stack',
    labelKey: 'timeline.motionLayout.templates.imageTrail.label',
    descriptionKey: 'timeline.motionLayout.templates.imageTrail.description',
    preferredSlots: 12,
    minSlots: 3,
    maxSlots: 18,
    defaultDurationSeconds: 10,
    parameterKeys: [...COMMON_PARAMETERS, 'trailLength', 'spacing'],
  }),
  template({
    id: 'poster-burst',
    category: 'stack',
    labelKey: 'timeline.motionLayout.templates.posterBurst.label',
    descriptionKey: 'timeline.motionLayout.templates.posterBurst.description',
    preferredSlots: 10,
    minSlots: 2,
    maxSlots: 16,
    defaultDurationSeconds: 12,
    parameterKeys: [...COMMON_PARAMETERS, 'staggerOverlap', 'hold'],
  }),
  template({
    id: 'diagonal-wipe',
    category: 'reveal',
    labelKey: 'timeline.motionLayout.templates.diagonalWipe.label',
    descriptionKey: 'timeline.motionLayout.templates.diagonalWipe.description',
    preferredSlots: 3,
    minSlots: 2,
    maxSlots: 8,
    defaultDurationSeconds: 8,
    parameterKeys: [...COMMON_PARAMETERS, 'edgeAngle', 'hold'],
  }),
  template({
    id: 'stripe-reveal',
    category: 'reveal',
    labelKey: 'timeline.motionLayout.templates.stripeReveal.label',
    descriptionKey: 'timeline.motionLayout.templates.stripeReveal.description',
    preferredSlots: 3,
    minSlots: 2,
    maxSlots: 8,
    defaultDurationSeconds: 8,
    parameterKeys: [...COMMON_PARAMETERS, 'strips', 'hold'],
  }),
  template({
    id: 'split-reveal',
    category: 'reveal',
    labelKey: 'timeline.motionLayout.templates.splitReveal.label',
    descriptionKey: 'timeline.motionLayout.templates.splitReveal.description',
    preferredSlots: 4,
    minSlots: 2,
    maxSlots: 10,
    defaultDurationSeconds: 8,
    parameterKeys: [...COMMON_PARAMETERS, 'direction', 'hold'],
  }),
  template({
    id: 'showcase-stream',
    category: 'perspective',
    labelKey: 'timeline.motionLayout.templates.showcaseStream.label',
    descriptionKey: 'timeline.motionLayout.templates.showcaseStream.description',
    preferredSlots: 12,
    minSlots: 4,
    maxSlots: 18,
    defaultDurationSeconds: 16,
    parameterKeys: [
      'durationSeconds',
      'backgroundColor',
      'cornerRadius',
      'ringTilt',
      'ringOpening',
      'ringSize',
      'cardSize',
      'backFade',
      'perspective',
    ],
  }),
  template({
    id: 'card-totem',
    category: 'perspective',
    labelKey: 'timeline.motionLayout.templates.cardTotem.label',
    descriptionKey: 'timeline.motionLayout.templates.cardTotem.description',
    preferredSlots: 6,
    minSlots: 3,
    maxSlots: 12,
    defaultDurationSeconds: 12,
    parameterKeys: [...COMMON_PARAMETERS, 'cardSize', 'perspective', 'backFade'],
  }),
  template({
    id: 'film-strip',
    category: 'perspective',
    labelKey: 'timeline.motionLayout.templates.filmStrip.label',
    descriptionKey: 'timeline.motionLayout.templates.filmStrip.description',
    preferredSlots: 6,
    minSlots: 3,
    maxSlots: 14,
    defaultDurationSeconds: 12,
    parameterKeys: [...COMMON_PARAMETERS, 'cardSize', 'ringTilt', 'perspective'],
  }),
  template({
    id: 'orbit-carousel',
    category: 'perspective',
    labelKey: 'timeline.motionLayout.templates.orbitCarousel.label',
    descriptionKey: 'timeline.motionLayout.templates.orbitCarousel.description',
    preferredSlots: 4,
    minSlots: 3,
    maxSlots: 10,
    defaultDurationSeconds: 12,
    parameterKeys: [...COMMON_PARAMETERS, 'ringSize', 'cardSize', 'backFade', 'perspective'],
  }),
  template({
    id: 'flip-grid',
    category: 'grid',
    labelKey: 'timeline.motionLayout.templates.flipGrid.label',
    descriptionKey: 'timeline.motionLayout.templates.flipGrid.description',
    preferredSlots: 8,
    minSlots: 4,
    maxSlots: 16,
    defaultDurationSeconds: 8,
    parameterKeys: [...COMMON_PARAMETERS, 'gap', 'direction', 'hold', 'perspective'],
  }),
]

export const MOTION_LAYOUT_TEMPLATE_BY_ID = Object.fromEntries(
  MOTION_LAYOUT_TEMPLATES.map((entry) => [entry.id, entry]),
) as Record<MotionLayoutTemplateId, MotionLayoutTemplateDefinition>

export function createDefaultMotionLayoutSettings(
  templateId: MotionLayoutTemplateId,
): MotionLayoutSettings {
  return { ...MOTION_LAYOUT_TEMPLATE_BY_ID[templateId].defaults }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function frameAt(at: number, durationInFrames: number): number {
  return Math.round(clamp(at, 0, 1) * Math.max(1, durationInFrames - 1))
}

function easingConfig(easing: MotionLayoutEasing): EasingConfig {
  switch (easing) {
    case 'snappy':
      return {
        type: 'cubic-bezier',
        bezier: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 },
      }
    case 'overshoot':
      return {
        type: 'cubic-bezier',
        bezier: { x1: 0.34, y1: 1.45, x2: 0.64, y2: 1 },
      }
    case 'spring':
      return {
        type: 'spring',
        spring: { tension: 220, friction: 20, mass: 0.9 },
      }
    case 'smooth':
      return {
        type: 'cubic-bezier',
        bezier: { x1: 0.45, y1: 0, x2: 0.2, y2: 1 },
      }
  }
}

function keyframeEasing(easing: MotionSnapshot['easing']): {
  easing: EasingType
  easingConfig?: EasingConfig
} {
  if (easing === 'hold') return { easing: 'hold' }
  if (easing === 'linear') return { easing: 'linear' }
  const config = easingConfig(easing ?? 'smooth')
  return { easing: config.type, easingConfig: config }
}

function buildPropertiesFromSnapshots(
  itemId: string,
  durationInFrames: number,
  snapshots: MotionSnapshot[],
): PropertyKeyframes[] {
  const properties: Array<keyof MotionValues> = [
    'x',
    'y',
    'width',
    'height',
    'rotation',
    'opacity',
    'depthDim',
    'cornerRadius',
  ]

  return properties.flatMap((property) => {
    const byFrame = new Map<number, Keyframe>()
    for (const snapshot of snapshots) {
      const value = snapshot.values[property]
      if (value === undefined) continue
      const frame = frameAt(snapshot.at, durationInFrames)
      byFrame.set(frame, {
        id: `motion-layout:${itemId}:${property}:${frame}`,
        frame,
        value,
        ...keyframeEasing(snapshot.easing),
      })
    }
    const keyframes = [...byFrame.values()].sort((left, right) => left.frame - right.frame)
    if (keyframes.length === 0) return []
    if (property === 'depthDim') {
      return [
        {
          property: motionLayoutDepthProperty(itemId),
          keyframes: keyframes.map((keyframe) => ({
            ...keyframe,
            value: -clamp(keyframe.value, 0, 1),
          })),
        },
      ]
    }
    return [{ property: property as AnimatableProperty, keyframes }]
  })
}

function rectValues(rect: Rect, cornerRadius: number, extra?: Partial<MotionValues>): MotionValues {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    rotation: 0,
    opacity: 1,
    depthDim: 0,
    cornerRadius,
    ...extra,
  }
}

function scaleRect(rect: Rect, scale: number): Rect {
  return { ...rect, width: rect.width * scale, height: rect.height * scale }
}

function insetRect(width: number, height: number, inset: number): Rect {
  return {
    x: 0,
    y: 0,
    width: Math.max(1, width - inset * 2),
    height: Math.max(1, height - inset * 2),
  }
}

function gridRects(
  count: number,
  width: number,
  height: number,
  settings: MotionLayoutSettings,
): Rect[] {
  const padding = Math.min(width, height) * settings.padding
  const gap = Math.min(width, height) * settings.gap
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  const availableWidth = width - padding * 2
  const availableHeight = height - padding * 2
  const cellWidth = Math.max(1, (availableWidth - gap * (cols - 1)) / cols)
  const cellHeight = Math.max(1, (availableHeight - gap * (rows - 1)) / rows)

  return Array.from({ length: count }, (_, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    return {
      x: -width / 2 + padding + col * (cellWidth + gap) + cellWidth / 2,
      y: -height / 2 + padding + row * (cellHeight + gap) + cellHeight / 2,
      width: cellWidth,
      height: cellHeight,
    }
  })
}

function buildGridReveal(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
): MotionLayoutSlotPlan[] {
  const rects = gridRects(slotIds.length, width, height, settings)
  const cornerRadius = Math.min(width, height) * settings.cornerRadius
  const stagger = Math.min(0.075, 0.28 / Math.max(1, slotIds.length))

  return slotIds.map((itemId, index) => {
    const rect = rects[index]!
    const hidden = scaleRect(rect, 0.86)
    const direction = index % 2 === 0 ? 1 : -1
    const enterStart = index * stagger
    const enterEnd = Math.min(0.42, enterStart + 0.16)
    const exitStart = Math.min(0.86, 0.7 + index * stagger * 0.45)
    const snapshots: MotionSnapshot[] = [
      {
        at: 0,
        easing: settings.easing,
        values: rectValues(hidden, cornerRadius, {
          y: rect.y + direction * height * 0.08,
          opacity: 0,
        }),
      },
      {
        at: enterStart,
        easing: settings.easing,
        values: rectValues(hidden, cornerRadius, {
          y: rect.y + direction * height * 0.08,
          opacity: 0,
        }),
      },
      { at: enterEnd, easing: 'hold', values: rectValues(rect, cornerRadius) },
      { at: exitStart, easing: settings.easing, values: rectValues(rect, cornerRadius) },
      {
        at: 1,
        easing: settings.easing,
        values: rectValues(hidden, cornerRadius, {
          y: rect.y - direction * height * 0.08,
          opacity: 0,
        }),
      },
    ]
    return {
      itemId,
      keyframes: {
        itemId,
        properties: buildPropertiesFromSnapshots(itemId, durationInFrames, snapshots),
      },
    }
  })
}

function buildCenterStage(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
): MotionLayoutSlotPlan[] {
  const padding = Math.min(width, height) * settings.padding
  const rect = insetRect(width, height, padding)
  const cornerRadius = Math.min(width, height) * settings.cornerRadius
  const segment = 1 / slotIds.length

  return slotIds.map((itemId, index) => {
    const start = index * segment
    const end = (index + 1) * segment
    const hidden = rectValues(scaleRect(rect, 0.94), cornerRadius, { opacity: 0 })
    const visible = rectValues(rect, cornerRadius)
    const snapshots: MotionSnapshot[] = [{ at: 0, easing: settings.easing, values: hidden }]

    if (index === 0) snapshots.push({ at: 0, easing: 'hold', values: visible })
    snapshots.push(
      {
        at: Math.max(0, start - segment * 0.12),
        easing: settings.easing,
        values: hidden,
      },
      { at: start + segment * 0.12, easing: 'hold', values: visible },
      { at: end - segment * 0.14, easing: settings.easing, values: visible },
      {
        at: end,
        easing: settings.easing,
        values: rectValues(scaleRect(rect, 1.035), cornerRadius, { opacity: 0 }),
      },
    )
    if (index === 0) {
      snapshots.push(
        { at: 1 - segment * 0.12, easing: settings.easing, values: hidden },
        { at: 1, easing: settings.easing, values: visible },
      )
    } else {
      snapshots.push({ at: 1, easing: settings.easing, values: hidden })
    }

    return {
      itemId,
      keyframes: {
        itemId,
        properties: buildPropertiesFromSnapshots(itemId, durationInFrames, snapshots),
      },
    }
  })
}

function focusShiftRect(
  slotIndex: number,
  activeIndex: number,
  count: number,
  width: number,
  height: number,
  settings: MotionLayoutSettings,
): MotionValues {
  const edge = Math.min(width, height) * settings.padding
  const gap = Math.min(width, height) * settings.gap
  const availableWidth = width - edge * 2
  const availableHeight = height - edge * 2
  const railWidth = availableWidth * clamp(settings.railSize, 0.18, 0.4)
  const focusWidth = availableWidth - railWidth - gap
  const cornerRadius = Math.min(width, height) * settings.cornerRadius

  if (slotIndex === activeIndex) {
    return rectValues(
      {
        x: -width / 2 + edge + focusWidth / 2,
        y: 0,
        width: focusWidth,
        height: availableHeight,
      },
      cornerRadius,
    )
  }

  const railSlots = Array.from({ length: count }, (_, index) => index).filter(
    (index) => index !== activeIndex,
  )
  const railIndex = railSlots.indexOf(slotIndex)
  const railHeight = Math.max(
    1,
    (availableHeight - gap * (railSlots.length - 1)) / railSlots.length,
  )
  return rectValues(
    {
      x: width / 2 - edge - railWidth / 2,
      y: -height / 2 + edge + railIndex * (railHeight + gap) + railHeight / 2,
      width: railWidth,
      height: railHeight,
    },
    cornerRadius,
    { depthDim: 0 },
  )
}

function buildPhaseMorph(
  slotIds: string[],
  durationInFrames: number,
  settings: MotionLayoutSettings,
  valuesAtPhase: (slotIndex: number, phase: number) => MotionValues,
  holdRatio = 0.62,
): MotionLayoutSlotPlan[] {
  const count = slotIds.length
  const segment = 1 / count
  return slotIds.map((itemId, slotIndex) => {
    const snapshots: MotionSnapshot[] = []
    for (let phase = 0; phase < count; phase += 1) {
      const at = phase * segment
      const values = valuesAtPhase(slotIndex, phase)
      snapshots.push({ at, easing: 'hold', values })
      snapshots.push({ at: at + segment * holdRatio, easing: settings.easing, values })
    }
    snapshots.push({ at: 1, easing: settings.easing, values: valuesAtPhase(slotIndex, 0) })
    return {
      itemId,
      keyframes: {
        itemId,
        properties: buildPropertiesFromSnapshots(itemId, durationInFrames, snapshots),
      },
    }
  })
}

function buildFocusShift(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
): MotionLayoutSlotPlan[] {
  return buildPhaseMorph(
    slotIds,
    durationInFrames,
    settings,
    (slotIndex, phase) => focusShiftRect(slotIndex, phase, slotIds.length, width, height, settings),
    0.66,
  )
}

function buildStackSlide(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
): MotionLayoutSlotPlan[] {
  const inset = Math.min(width, height) * settings.cardInset
  const base = insetRect(width, height, inset)
  const cornerRadius = Math.min(width, height) * settings.cornerRadius
  const count = slotIds.length

  return buildPhaseMorph(
    slotIds,
    durationInFrames,
    settings,
    (slotIndex, phase) => {
      const depth = (slotIndex - phase + count) % count
      const visibleDepth = Math.min(depth, 4)
      const scale = Math.max(0.78, 1 - visibleDepth * 0.055)
      return rectValues(scaleRect(base, scale), cornerRadius, {
        y: visibleDepth * height * 0.026,
        rotation: visibleDepth === 0 ? 0 : (slotIndex % 2 === 0 ? 1 : -1) * visibleDepth * 0.65,
        opacity: depth > 4 ? 0 : 1,
        depthDim: clamp(visibleDepth * 0.12, 0, 0.48),
      })
    },
    0.68,
  )
}

function buildPositionDance(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
): MotionLayoutSlotPlan[] {
  const spread = 1 + settings.spacing
  const positions = [
    { x: -width * 0.26 * spread, y: height * 0.08, scale: 0.7, rotation: -5 },
    { x: 0, y: -height * 0.08, scale: 1, rotation: 0 },
    { x: width * 0.26 * spread, y: height * 0.08, scale: 0.76, rotation: 5 },
    { x: 0, y: height * 0.22 * spread, scale: 0.62, rotation: 0 },
  ]
  const base: Rect = { x: 0, y: 0, width: width * 0.42, height: height * 0.62 }
  const cornerRadius = Math.min(width, height) * settings.cornerRadius
  const phaseCount = Math.max(3, Math.min(slotIds.length, positions.length))

  return buildPhaseMorph(
    slotIds,
    durationInFrames,
    settings,
    (slotIndex, phase) => {
      const position = positions[(slotIndex + phase) % phaseCount]!
      return rectValues(scaleRect(base, position.scale), cornerRadius, {
        x: position.x,
        y: position.y,
        rotation: position.rotation,
        opacity: 1,
        depthDim: clamp((1 - position.scale) * 0.25, 0, 0.12),
      })
    },
    0.54,
  )
}

function signedCarouselDistance(slotIndex: number, activeIndex: number, count: number): number {
  let distance = (slotIndex - activeIndex + count) % count
  if (distance > count / 2) distance -= count
  return distance
}

function buildCarouselFlow(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
): MotionLayoutSlotPlan[] {
  const padding = Math.min(width, height) * settings.padding
  const base: Rect = {
    x: 0,
    y: 0,
    width: width * 0.56 - padding,
    height: height * 0.76 - padding,
  }
  const gap = Math.min(width, height) * settings.gap
  const cornerRadius = Math.min(width, height) * settings.cornerRadius
  const count = slotIds.length

  return buildPhaseMorph(
    slotIds,
    durationInFrames,
    settings,
    (slotIndex, phase) => {
      const distance = signedCarouselDistance(slotIndex, phase, count)
      const depth = Math.abs(distance)
      const scale = Math.pow(clamp(settings.sideScale, 0.55, 0.95), depth)
      const travel = (settings.direction === 'horizontal' ? base.width : base.height) * 0.72 + gap
      return rectValues(scaleRect(base, scale), cornerRadius, {
        x: settings.direction === 'horizontal' ? distance * travel : 0,
        y: settings.direction === 'vertical' ? distance * travel : depth * height * 0.018,
        opacity: 1,
      })
    },
    0.62,
  )
}

function makeSlotPlan(
  itemId: string,
  durationInFrames: number,
  snapshots: MotionSnapshot[],
): MotionLayoutSlotPlan {
  return {
    itemId,
    keyframes: {
      itemId,
      properties: buildPropertiesFromSnapshots(itemId, durationInFrames, snapshots),
    },
  }
}

function buildSpotlightZoom(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
): MotionLayoutSlotPlan[] {
  const grid = gridRects(slotIds.length, width, height, settings)
  const padding = Math.min(width, height) * settings.padding
  const focus = insetRect(width, height, padding)
  const cornerRadius = Math.min(width, height) * settings.cornerRadius

  return buildPhaseMorph(
    slotIds,
    durationInFrames,
    settings,
    (slotIndex, phase) =>
      slotIndex === phase
        ? rectValues(focus, cornerRadius)
        : rectValues(grid[slotIndex]!, cornerRadius, {
            opacity: 1,
            depthDim: clamp(settings.backgroundDim, 0, 0.72),
          }),
    0.64,
  )
}

function buildDeckPeel(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
): MotionLayoutSlotPlan[] {
  const inset = Math.min(width, height) * settings.cardInset
  const base = insetRect(width, height, inset)
  const cornerRadius = Math.min(width, height) * settings.cornerRadius
  const count = slotIds.length
  const segment = 1 / count
  const hold = clamp(settings.hold, 0.15, 0.75)

  return slotIds.map((itemId, slotIndex) => {
    const snapshots: MotionSnapshot[] = []
    for (let phase = 0; phase < count; phase += 1) {
      const at = phase * segment
      const depth = (slotIndex - phase + count) % count
      const scale = Math.max(0.8, 1 - Math.min(depth, 4) * 0.05)
      const resting = rectValues(scaleRect(base, scale), cornerRadius, {
        y: Math.min(depth, 4) * height * 0.022,
        rotation: depth === 0 ? 0 : (slotIndex % 2 === 0 ? -1 : 1) * depth,
        opacity: depth > 4 ? 0 : 1,
        depthDim: clamp(Math.min(depth, 4) * 0.11, 0, 0.44),
      })
      snapshots.push({ at, easing: 'hold', values: resting })
      snapshots.push({ at: at + segment * hold, easing: settings.easing, values: resting })
      if (depth === 0) {
        snapshots.push({
          at: at + segment * 0.96,
          easing: settings.easing,
          values: rectValues(scaleRect(base, 0.96), cornerRadius, {
            y: height * 0.58,
            rotation: slotIndex % 2 === 0 ? -9 : 9,
            opacity: 0,
          }),
        })
      }
    }
    snapshots.push({
      at: 1,
      easing: settings.easing,
      values: rectValues(base, cornerRadius),
    })
    return makeSlotPlan(itemId, durationInFrames, snapshots)
  })
}

function buildZoomParallax(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
): MotionLayoutSlotPlan[] {
  const padding = Math.min(width, height) * settings.padding
  const base = insetRect(width, height, padding)
  const cornerRadius = Math.min(width, height) * settings.cornerRadius
  const segment = 1 / slotIds.length
  const zoom = clamp(settings.zoom, 0.05, 0.8)
  const hold = clamp(settings.hold, 0.15, 0.75)

  return slotIds.map((itemId, index) => {
    const start = index * segment
    const end = (index + 1) * segment
    const direction = index % 2 === 0 ? 1 : -1
    const hidden = rectValues(scaleRect(base, 1 + zoom * 0.08), cornerRadius, { opacity: 0 })
    const startPose = rectValues(scaleRect(base, 1 + zoom * 0.08), cornerRadius, {
      x: -direction * width * zoom * 0.035,
    })
    const endPose = rectValues(scaleRect(base, 1 + zoom * 0.24), cornerRadius, {
      x: direction * width * zoom * 0.035,
    })
    return makeSlotPlan(itemId, durationInFrames, [
      { at: 0, easing: settings.easing, values: index === 0 ? startPose : hidden },
      { at: Math.max(0, start - segment * 0.12), easing: settings.easing, values: hidden },
      { at: start + segment * 0.08, easing: 'linear', values: startPose },
      { at: start + segment * hold, easing: 'linear', values: endPose },
      { at: end - segment * 0.08, easing: settings.easing, values: endPose },
      { at: end, easing: settings.easing, values: { ...endPose, opacity: 0 } },
      { at: 1, easing: settings.easing, values: index === 0 ? startPose : hidden },
    ])
  })
}

function buildPopGrid(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
): MotionLayoutSlotPlan[] {
  const rects = gridRects(slotIds.length, width, height, settings)
  const cornerRadius = Math.min(width, height) * settings.cornerRadius
  const window = Math.min(0.55, Math.max(0.22, settings.hold))

  return slotIds.map((itemId, index) => {
    const offset = (index / slotIds.length) * 0.72
    const rect = rects[index]!
    const hidden = rectValues(scaleRect(rect, 0.62), cornerRadius, { opacity: 0 })
    const visible = rectValues(rect, cornerRadius)
    return makeSlotPlan(itemId, durationInFrames, [
      { at: 0, easing: settings.easing, values: hidden },
      { at: offset, easing: settings.easing, values: hidden },
      { at: Math.min(0.88, offset + 0.08), easing: 'hold', values: visible },
      { at: Math.min(0.94, offset + window), easing: settings.easing, values: visible },
      { at: Math.min(1, offset + window + 0.08), easing: settings.easing, values: hidden },
      { at: 1, easing: settings.easing, values: hidden },
    ])
  })
}

function buildTickerLoop(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
): MotionLayoutSlotPlan[] {
  const count = slotIds.length
  const gap = Math.min(width, height) * settings.gap
  const zoom = clamp(settings.zoom, 0.2, 0.75)
  const horizontal = settings.direction === 'horizontal'
  const cardWidth = horizontal ? width * (0.22 + zoom * 0.18) : width * 0.34
  const cardHeight = horizontal ? height * 0.34 : height * (0.2 + zoom * 0.16)
  const travel = horizontal ? width + cardWidth + gap : height + cardHeight + gap
  const cornerRadius = Math.min(width, height) * settings.cornerRadius

  return slotIds.map((itemId, index) => {
    const lane = index % 2
    const lanePosition = Math.floor(index / 2)
    const laneCount = Math.ceil(count / 2)
    const normalized = lanePosition / Math.max(1, laneCount)
    const direction = lane === 0 ? 1 : -1
    const start = (normalized - 0.5) * travel
    const end = start + direction * travel
    const cross = lane === 0 ? -0.23 : 0.23
    const valuesAt = (position: number): MotionValues =>
      rectValues(
        {
          x: horizontal ? position : cross * width,
          y: horizontal ? cross * height : position,
          width: cardWidth,
          height: cardHeight,
        },
        cornerRadius,
        { rotation: settings.tilt * 100 },
      )
    return makeSlotPlan(itemId, durationInFrames, [
      { at: 0, easing: 'linear', values: valuesAt(start) },
      { at: 0.499, easing: 'linear', values: valuesAt(end) },
      { at: 0.501, easing: 'linear', values: valuesAt(start) },
      { at: 1, easing: 'linear', values: valuesAt(end) },
    ])
  })
}

function buildColumnDrift(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
): MotionLayoutSlotPlan[] {
  const columnCount = Math.min(3, slotIds.length)
  const gap = Math.min(width, height) * settings.gap
  const columnWidth = (width - gap * (columnCount + 1)) / columnCount
  const cardHeight = height * 0.42
  const cornerRadius = Math.min(width, height) * settings.cornerRadius

  return slotIds.map((itemId, index) => {
    const column = index % columnCount
    const row = Math.floor(index / columnCount)
    const direction = column % 2 === 0 ? 1 : -1
    const x = -width / 2 + gap + columnWidth / 2 + column * (columnWidth + gap)
    const startY = (row - 1) * (cardHeight + gap)
    const travel = height + cardHeight + gap
    const start: Rect = { x, y: startY, width: columnWidth, height: cardHeight }
    const end: Rect = { ...start, y: startY + direction * travel }
    return makeSlotPlan(itemId, durationInFrames, [
      { at: 0, easing: 'linear', values: rectValues(start, cornerRadius) },
      { at: 0.499, easing: 'linear', values: rectValues(end, cornerRadius) },
      {
        at: 0.501,
        easing: 'linear',
        values: rectValues({ ...start, y: startY - direction * travel }, cornerRadius),
      },
      { at: 1, easing: 'linear', values: rectValues(start, cornerRadius) },
    ])
  })
}

function buildImageTrail(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
): MotionLayoutSlotPlan[] {
  const count = slotIds.length
  const cornerRadius = Math.min(width, height) * settings.cornerRadius
  const spread = clamp(settings.trailLength, 0.2, 1) * (1 + settings.spacing)
  const card: Rect = { x: 0, y: 0, width: width * 0.24, height: height * 0.34 }

  return slotIds.map((itemId, index) => {
    const at = (index / Math.max(1, count - 1)) * 0.72
    const angle = -Math.PI * 0.86 + (index / Math.max(1, count - 1)) * Math.PI * 0.72
    const target = rectValues(card, cornerRadius, {
      x: Math.cos(angle) * width * 0.42 * spread,
      y: Math.sin(angle) * height * 0.34 * spread + height * 0.12,
      rotation: (angle * 180) / Math.PI + 72,
    })
    const hidden = {
      ...target,
      width: target.width * 0.38,
      height: target.height * 0.38,
      opacity: 0,
    }
    return makeSlotPlan(itemId, durationInFrames, [
      { at: 0, easing: settings.easing, values: hidden },
      { at, easing: settings.easing, values: hidden },
      { at: Math.min(0.88, at + 0.1), easing: 'hold', values: target },
      { at: Math.min(0.94, at + 0.28), easing: settings.easing, values: target },
      { at: Math.min(1, at + 0.4), easing: settings.easing, values: hidden },
      { at: 1, easing: settings.easing, values: hidden },
    ])
  })
}

function buildPosterBurst(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
): MotionLayoutSlotPlan[] {
  const cornerRadius = Math.min(width, height) * settings.cornerRadius
  const full = insetRect(width, height, Math.min(width, height) * settings.padding)
  const overlap = clamp(settings.staggerOverlap, 0.1, 0.9)
  const segment = 1 / Math.max(1, slotIds.length - (slotIds.length - 1) * overlap)
  const hold = clamp(settings.hold, 0.12, 0.65)

  return slotIds.map((itemId, index) => {
    const start = Math.min(0.86, index * segment * (1 - overlap))
    const target = rectValues(full, cornerRadius, {
      rotation: index % 2 === 0 ? -1.5 : 1.5,
    })
    const hidden = rectValues(scaleRect(full, 0.2), cornerRadius, {
      rotation: index % 2 === 0 ? -12 : 12,
      opacity: 0,
    })
    return makeSlotPlan(itemId, durationInFrames, [
      { at: 0, easing: settings.easing, values: hidden },
      { at: start, easing: settings.easing, values: hidden },
      { at: Math.min(0.92, start + 0.11), easing: 'hold', values: target },
      { at: Math.min(0.96, start + hold * segment), easing: settings.easing, values: target },
      {
        at: Math.min(1, start + hold * segment + 0.1),
        easing: settings.easing,
        values: { ...target, opacity: 0 },
      },
      { at: 1, easing: settings.easing, values: hidden },
    ])
  })
}

function buildWipeSequence(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
  kind: 'diagonal' | 'stripe' | 'split',
): MotionLayoutSlotPlan[] {
  const full = insetRect(width, height, Math.min(width, height) * settings.padding)
  const cornerRadius = Math.min(width, height) * settings.cornerRadius
  const segment = 1 / slotIds.length
  const hold = clamp(settings.hold, 0.15, 0.75)

  return slotIds.map((itemId, index) => {
    const start = index * segment
    const end = (index + 1) * segment
    const direction = index % 2 === 0 ? 1 : -1
    const hidden = rectValues(full, cornerRadius, {
      x:
        kind === 'split' || settings.direction === 'vertical' || kind === 'stripe'
          ? 0
          : direction * width * 0.32,
      y:
        kind === 'split'
          ? 0
          : settings.direction === 'vertical' || kind === 'stripe'
            ? direction * height * 0.32
            : 0,
      rotation: kind === 'diagonal' ? settings.edgeAngle * 0.08 : 0,
      opacity: 0,
    })
    const visible = rectValues(full, cornerRadius)
    return makeSlotPlan(itemId, durationInFrames, [
      { at: 0, easing: settings.easing, values: index === 0 ? visible : hidden },
      { at: Math.max(0, start - segment * 0.1), easing: settings.easing, values: hidden },
      { at: start + segment * 0.12, easing: 'hold', values: visible },
      { at: start + segment * hold, easing: settings.easing, values: visible },
      { at: end, easing: settings.easing, values: { ...visible, opacity: 0 } },
      { at: 1, easing: settings.easing, values: index === 0 ? visible : hidden },
    ])
  })
}

function buildPerspectiveOrbit(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
  variant: 'stream' | 'orbit',
): MotionLayoutSlotPlan[] {
  const count = slotIds.length
  const radiusX = width * clamp(settings.ringSize, 0.35, 1.1) * (variant === 'stream' ? 0.43 : 0.34)
  const radiusY = height * (variant === 'stream' ? 0.22 : 0.16)
  const cardWidth = width * clamp(settings.cardSize, 0.12, 0.5) * (variant === 'orbit' ? 1.5 : 1)
  const cardHeight =
    height * clamp(settings.cardSize, 0.12, 0.5) * (variant === 'orbit' ? 1.85 : 1.45)
  const cornerRadius = Math.min(width, height) * settings.cornerRadius
  const opening = clamp(settings.ringOpening, 0.2, 1)

  return buildPhaseMorph(
    slotIds,
    durationInFrames,
    settings,
    (slotIndex, phase) => {
      const distance = signedCarouselDistance(slotIndex, phase, count)
      const angle = (distance / Math.max(1, count)) * Math.PI * 2 * opening
      const front = (Math.cos(angle) + 1) / 2
      const scale = 0.58 + front * 0.42
      return rectValues(
        {
          x: Math.sin(angle) * radiusX,
          y:
            Math.cos(angle) * radiusY * settings.ringTilt +
            (1 - front) * height * (variant === 'stream' ? -0.04 : 0.03),
          width: cardWidth * scale,
          height: cardHeight * scale,
        },
        cornerRadius,
        {
          rotation: -Math.sin(angle) * settings.perspective * 70,
          opacity: 1,
          depthDim: clamp((1 - front) * settings.backFade, 0, 0.72),
        },
      )
    },
    variant === 'stream' ? 0.22 : 0.58,
  )
}

function buildCardTotem(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
): MotionLayoutSlotPlan[] {
  const count = slotIds.length
  const cardWidth = width * clamp(settings.cardSize, 0.14, 0.5) * 1.25
  const cardHeight = height * clamp(settings.cardSize, 0.14, 0.5) * 1.6
  const cornerRadius = Math.min(width, height) * settings.cornerRadius

  return buildPhaseMorph(
    slotIds,
    durationInFrames,
    settings,
    (slotIndex, phase) => {
      const distance = signedCarouselDistance(slotIndex, phase, count)
      const depth = Math.abs(distance)
      const scale = Math.max(0.5, 1 - depth * 0.1)
      return rectValues(
        {
          x: Math.sin(distance * 0.8) * width * settings.perspective * 0.12,
          y: distance * cardHeight * 0.7,
          width: cardWidth * scale,
          height: cardHeight * scale,
        },
        cornerRadius,
        {
          rotation: -Math.sin(distance * 0.6) * settings.perspective * 45,
          opacity: 1,
          depthDim: clamp(depth * settings.backFade * 0.16, 0, 0.62),
        },
      )
    },
    0.56,
  )
}

function buildFilmStrip(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
): MotionLayoutSlotPlan[] {
  const count = slotIds.length
  const cardWidth = width * clamp(settings.cardSize, 0.14, 0.48) * 1.5
  const cardHeight = height * clamp(settings.cardSize, 0.14, 0.48) * 1.65
  const cornerRadius = Math.min(width, height) * settings.cornerRadius

  return buildPhaseMorph(
    slotIds,
    durationInFrames,
    settings,
    (slotIndex, phase) => {
      const distance = signedCarouselDistance(slotIndex, phase, count)
      const depth = Math.abs(distance)
      const scale = Math.max(0.55, 1 - depth * settings.perspective * 0.22)
      return rectValues(
        {
          x: distance * cardWidth * 0.82,
          y: Math.sin(distance * 0.72) * height * 0.055 + settings.ringTilt * height * 0.05,
          width: cardWidth * scale,
          height: cardHeight * scale,
        },
        cornerRadius,
        {
          rotation: settings.ringTilt * 18 + distance * settings.perspective * 5,
          opacity: 1,
          depthDim: clamp(depth * 0.12, 0, 0.55),
        },
      )
    },
    0.36,
  )
}

function buildFlipGrid(
  slotIds: string[],
  width: number,
  height: number,
  durationInFrames: number,
  settings: MotionLayoutSettings,
): MotionLayoutSlotPlan[] {
  const cellCount = Math.ceil(slotIds.length / 2)
  const rects = gridRects(cellCount, width, height, settings)
  const cornerRadius = Math.min(width, height) * settings.cornerRadius
  const hold = clamp(settings.hold, 0.15, 0.72)
  const collapsedScale = clamp(0.12 - settings.perspective * 0.2, 0.005, 0.12)

  return slotIds.map((itemId, index) => {
    const setIndex = index >= cellCount ? 1 : 0
    const rect = rects[index % cellCount]!
    const collapsed = rectValues(
      {
        ...rect,
        width:
          settings.direction === 'horizontal'
            ? Math.max(1, rect.width * collapsedScale)
            : rect.width,
        height:
          settings.direction === 'vertical'
            ? Math.max(1, rect.height * collapsedScale)
            : rect.height,
      },
      cornerRadius,
      { opacity: 0 },
    )
    const visible = rectValues(rect, cornerRadius)
    const firstVisible = setIndex === 0
    return makeSlotPlan(itemId, durationInFrames, [
      { at: 0, easing: 'hold', values: firstVisible ? visible : collapsed },
      { at: hold, easing: settings.easing, values: firstVisible ? visible : collapsed },
      { at: 0.5, easing: settings.easing, values: collapsed },
      { at: 0.5 + (1 - hold) * 0.35, easing: 'hold', values: firstVisible ? collapsed : visible },
      {
        at: 1 - (1 - hold) * 0.35,
        easing: settings.easing,
        values: firstVisible ? collapsed : visible,
      },
      { at: 1, easing: settings.easing, values: firstVisible ? visible : collapsed },
    ])
  })
}

export function buildMotionLayoutPlan(input: BuildMotionLayoutPlanInput): MotionLayoutPlan {
  const durationInFrames = Math.max(2, Math.round(input.settings.durationSeconds * input.fps))
  let slots: MotionLayoutSlotPlan[]

  switch (input.templateId) {
    case 'grid-reveal':
      slots = buildGridReveal(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
      )
      break
    case 'center-stage':
      slots = buildCenterStage(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
      )
      break
    case 'focus-shift':
      slots = buildFocusShift(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
      )
      break
    case 'stack-slide':
      slots = buildStackSlide(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
      )
      break
    case 'position-dance':
      slots = buildPositionDance(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
      )
      break
    case 'carousel-flow':
      slots = buildCarouselFlow(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
      )
      break
    case 'spotlight-zoom':
      slots = buildSpotlightZoom(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
      )
      break
    case 'deck-peel':
      slots = buildDeckPeel(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
      )
      break
    case 'zoom-parallax':
      slots = buildZoomParallax(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
      )
      break
    case 'pop-grid':
      slots = buildPopGrid(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
      )
      break
    case 'ticker-loop':
      slots = buildTickerLoop(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
      )
      break
    case 'column-drift':
      slots = buildColumnDrift(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
      )
      break
    case 'image-trail':
      slots = buildImageTrail(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
      )
      break
    case 'poster-burst':
      slots = buildPosterBurst(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
      )
      break
    case 'diagonal-wipe':
      slots = buildWipeSequence(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
        'diagonal',
      )
      break
    case 'stripe-reveal':
      slots = buildWipeSequence(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
        'stripe',
      )
      break
    case 'split-reveal':
      slots = buildWipeSequence(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
        'split',
      )
      break
    case 'showcase-stream':
      slots = buildPerspectiveOrbit(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
        'stream',
      )
      break
    case 'card-totem':
      slots = buildCardTotem(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
      )
      break
    case 'film-strip':
      slots = buildFilmStrip(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
      )
      break
    case 'orbit-carousel':
      slots = buildPerspectiveOrbit(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
        'orbit',
      )
      break
    case 'flip-grid':
      slots = buildFlipGrid(
        input.slotIds,
        input.width,
        input.height,
        durationInFrames,
        input.settings,
      )
      break
  }

  return { durationInFrames, slots }
}

const RESOLVED_DEFAULTS: MotionLayoutResolvedSlot = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  rotation: 0,
  opacity: 1,
  depthDim: 0,
  cornerRadius: 0,
}

export function resolveMotionLayoutSlot(
  slot: MotionLayoutSlotPlan,
  frame: number,
): MotionLayoutResolvedSlot {
  const result = { ...RESOLVED_DEFAULTS }
  for (const property of slot.keyframes.properties) {
    if (property.property === motionLayoutDepthProperty(slot.itemId)) {
      result.depthDim = clamp(-interpolatePropertyValue(property.keyframes, frame, 0), 0, 1)
      continue
    }
    if (!(property.property in result)) continue
    const key = property.property as keyof MotionLayoutResolvedSlot
    result[key] = interpolatePropertyValue(property.keyframes, frame, result[key])
  }
  return result
}
