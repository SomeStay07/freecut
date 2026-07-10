export type MotionLayoutTemplateId =
  | 'grid-reveal'
  | 'center-stage'
  | 'focus-shift'
  | 'stack-slide'
  | 'position-dance'
  | 'carousel-flow'
  | 'spotlight-zoom'
  | 'deck-peel'
  | 'zoom-parallax'
  | 'pop-grid'
  | 'ticker-loop'
  | 'column-drift'
  | 'image-trail'
  | 'poster-burst'
  | 'diagonal-wipe'
  | 'stripe-reveal'
  | 'split-reveal'
  | 'showcase-stream'
  | 'card-totem'
  | 'film-strip'
  | 'orbit-carousel'
  | 'flip-grid'

export type MotionLayoutCategory =
  | 'grid'
  | 'spotlight'
  | 'stack'
  | 'carousel'
  | 'reveal'
  | 'perspective'

export type MotionLayoutEasing = 'smooth' | 'snappy' | 'overshoot' | 'spring'

export type MotionLayoutDirection = 'horizontal' | 'vertical'

export type MotionLayoutFrameAspect = '16:9' | '4:3' | '1:1' | '4:5' | '9:16'

export type MotionLayoutParameterKey =
  | 'durationSeconds'
  | 'backgroundColor'
  | 'padding'
  | 'gap'
  | 'cornerRadius'
  | 'easing'
  | 'direction'
  | 'railSize'
  | 'sideScale'
  | 'cardInset'
  | 'spacing'
  | 'backgroundDim'
  | 'zoom'
  | 'tilt'
  | 'trailLength'
  | 'staggerOverlap'
  | 'edgeAngle'
  | 'strips'
  | 'hold'
  | 'perspective'
  | 'ringTilt'
  | 'ringOpening'
  | 'ringSize'
  | 'cardSize'
  | 'backFade'

/**
 * Serializable settings shared by the Motion Layout editor and compiler.
 * Percentage-like values are stored as normalized ratios so a layout can be
 * recompiled for a different canvas aspect ratio without pixel migration.
 */
export interface MotionLayoutSettings {
  durationSeconds: number
  backgroundColor: string
  padding: number
  gap: number
  cornerRadius: number
  easing: MotionLayoutEasing
  direction: MotionLayoutDirection
  railSize: number
  sideScale: number
  cardInset: number
  spacing: number
  backgroundDim: number
  zoom: number
  tilt: number
  trailLength: number
  staggerOverlap: number
  edgeAngle: number
  strips: number
  hold: number
  perspective: number
  ringTilt: number
  ringOpening: number
  ringSize: number
  cardSize: number
  backFade: number
}

export interface MotionLayoutSlotBinding {
  id: string
  compositionId: string
  label: string
}

/** Metadata retained on a generated sub-composition until it is detached. */
export interface MotionLayoutInstance {
  templateId: MotionLayoutTemplateId
  templateVersion: number
  /** Output frame ratio. Missing on legacy layouts, which retain their stored dimensions. */
  frameAspect?: MotionLayoutFrameAspect
  settings: MotionLayoutSettings
  /** Active source compositions in stage order. Older projects use `slots` order. */
  slotOrder?: string[]
  /** Complete reusable source pool, including sources temporarily removed from the stage. */
  slots: MotionLayoutSlotBinding[]
}
