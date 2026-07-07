/**
 * Lottie fill/stroke color → FreeCut CSS color string.
 *
 * The exporter stores color as sRGB `[r, g, b]` in 0-1 with a separate 0-100
 * opacity (see `../export/color.ts`). This inverts that exactly: sRGB channels
 * round-trip through hex, and a sub-100 opacity is folded into an 8-digit
 * `#rrggbbaa` string (the color picker understands alpha hex).
 */

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

function channelHex(c01: number): string {
  const v = Math.round(clamp01(c01) * 255)
  return v.toString(16).padStart(2, '0')
}

/**
 * Build a hex color from Lottie sRGB components (0-1) and an optional 0-100
 * opacity. Emits `#rrggbb` at full opacity, `#rrggbbaa` otherwise.
 */
export function lottieColorToHex(rgb: number[] | undefined, opacityPct?: number): string {
  const r = rgb?.[0] ?? 0
  const g = rgb?.[1] ?? 0
  const b = rgb?.[2] ?? 0
  const base = `#${channelHex(r)}${channelHex(g)}${channelHex(b)}`
  const alpha = opacityPct === undefined ? 100 : opacityPct
  if (alpha >= 100) return base
  return `${base}${channelHex(clamp01(alpha / 100))}`
}
