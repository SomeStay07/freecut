export type CompositionContentFit = 'fill' | 'contain' | 'cover'

export interface CompositionFitLayout {
  offsetX: number
  offsetY: number
  width: number
  height: number
  scaleX: number
  scaleY: number
}

export interface CompositionFraming {
  scale?: number
  offsetX?: number
  offsetY?: number
}

/**
 * Fit an authored composition canvas into a wrapper viewport.
 * `cover` and `contain` always use one uniform scale, preventing distortion.
 */
export function calculateCompositionFitLayout(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  fit: CompositionContentFit = 'fill',
): CompositionFitLayout {
  const safeSourceWidth = Math.max(1, Number.isFinite(sourceWidth) ? sourceWidth : 1)
  const safeSourceHeight = Math.max(1, Number.isFinite(sourceHeight) ? sourceHeight : 1)
  const safeTargetWidth = Math.max(1, Number.isFinite(targetWidth) ? targetWidth : 1)
  const safeTargetHeight = Math.max(1, Number.isFinite(targetHeight) ? targetHeight : 1)

  if (fit === 'fill') {
    return {
      offsetX: 0,
      offsetY: 0,
      width: safeTargetWidth,
      height: safeTargetHeight,
      scaleX: safeTargetWidth / safeSourceWidth,
      scaleY: safeTargetHeight / safeSourceHeight,
    }
  }

  const widthScale = safeTargetWidth / safeSourceWidth
  const heightScale = safeTargetHeight / safeSourceHeight
  const scale =
    fit === 'cover' ? Math.max(widthScale, heightScale) : Math.min(widthScale, heightScale)
  const width = safeSourceWidth * scale
  const height = safeSourceHeight * scale

  return {
    offsetX: (safeTargetWidth - width) / 2,
    offsetY: (safeTargetHeight - height) / 2,
    width,
    height,
    scaleX: scale,
    scaleY: scale,
  }
}

/** Apply user framing to fitted content while keeping it clipped by its wrapper. */
export function applyCompositionFraming(
  layout: CompositionFitLayout,
  targetWidth: number,
  targetHeight: number,
  framing: CompositionFraming = {},
): CompositionFitLayout {
  const scale = Math.max(1, Math.min(4, framing.scale ?? 1))
  const offsetX = Math.max(-1, Math.min(1, framing.offsetX ?? 0))
  const offsetY = Math.max(-1, Math.min(1, framing.offsetY ?? 0))
  const width = layout.width * scale
  const height = layout.height * scale
  const centeredX = (targetWidth - width) / 2
  const centeredY = (targetHeight - height) / 2
  const panX = Math.max(0, width - targetWidth) * 0.5 * offsetX
  const panY = Math.max(0, height - targetHeight) * 0.5 * offsetY

  return {
    offsetX: centeredX + panX,
    offsetY: centeredY + panY,
    width,
    height,
    scaleX: layout.scaleX * scale,
    scaleY: layout.scaleY * scale,
  }
}
