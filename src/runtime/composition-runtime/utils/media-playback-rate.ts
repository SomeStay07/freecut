export const MIN_NATIVE_MEDIA_PLAYBACK_RATE = 0.25
export const MAX_NATIVE_MEDIA_PLAYBACK_RATE = 4

/**
 * Native media elements reject extreme rates in some browsers. Timeline math
 * must retain the authored rate; only the decoder-facing assignment is capped.
 */
export function clampNativeMediaPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1
  return Math.max(MIN_NATIVE_MEDIA_PLAYBACK_RATE, Math.min(MAX_NATIVE_MEDIA_PLAYBACK_RATE, rate))
}

export function setNativeMediaPlaybackRate(
  element: Pick<HTMLMediaElement, 'playbackRate'>,
  rate: number,
): number {
  const safeRate = clampNativeMediaPlaybackRate(rate)
  try {
    element.playbackRate = safeRate
  } catch {
    // A platform may expose a narrower range than our conservative defaults.
    element.playbackRate = 1
    return 1
  }
  return safeRate
}
