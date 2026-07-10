export type CompositionContentFit = 'fill' | 'contain' | 'cover'

export interface CompositionFitLayout {
  offsetX: number
  offsetY: number
  width: number
  height: number
  scaleX: number
  scaleY: number
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
