/**
 * Pure CSS-color → linear-normalized-RGBA parser for Lottie export.
 *
 * Lottie fills/strokes store color as `[r, g, b]` in the 0-1 sRGB range with a
 * separate 0-100 opacity. FreeCut item colors come from the color picker as hex
 * (`#rgb` / `#rrggbb` / `#rrggbbaa`), `rgb()/rgba()`, or app-theme `oklch()`.
 * This module resolves all three WITHOUT a DOM/canvas so the exporter stays a
 * pure, testable function (export runs on the main thread, but we don't want to
 * depend on a live canvas to serialize a document).
 */

export interface Rgba01 {
  /** sRGB components, each 0-1. */
  rgb: [number, number, number]
  /** Alpha, 0-1. */
  a: number
}

const BLACK: Rgba01 = { rgb: [0, 0, 0], a: 1 }

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/** Parse any supported CSS color string. Falls back to opaque black on failure. */
export function parseCssColorToRgba01(color: string): Rgba01 {
  const trimmed = color.trim().toLowerCase()
  if (trimmed.startsWith('#')) return parseHex(trimmed) ?? BLACK
  if (trimmed.startsWith('rgb')) return parseRgbFunc(trimmed) ?? BLACK
  if (trimmed.startsWith('oklch')) return parseOklch(trimmed) ?? BLACK
  return BLACK
}

function parseHex(hex: string): Rgba01 | null {
  const h = hex.slice(1)
  const expand = (s: string): string =>
    s
      .split('')
      .map((c) => c + c)
      .join('')
  let r: number
  let g: number
  let b: number
  let a = 1
  if (h.length === 3 || h.length === 4) {
    r = parseInt(expand(h[0]!), 16)
    g = parseInt(expand(h[1]!), 16)
    b = parseInt(expand(h[2]!), 16)
    if (h.length === 4) a = parseInt(expand(h[3]!), 16) / 255
  } else if (h.length === 6 || h.length === 8) {
    r = parseInt(h.slice(0, 2), 16)
    g = parseInt(h.slice(2, 4), 16)
    b = parseInt(h.slice(4, 6), 16)
    if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255
  } else {
    return null
  }
  if ([r, g, b].some(Number.isNaN)) return null
  return { rgb: [r / 255, g / 255, b / 255], a }
}

function parseRgbFunc(str: string): Rgba01 | null {
  const inside = str.slice(str.indexOf('(') + 1, str.lastIndexOf(')'))
  const parts = inside.split(/[,/\s]+/).filter(Boolean)
  if (parts.length < 3) return null
  const channel = (raw: string): number =>
    raw.endsWith('%') ? clamp01(parseFloat(raw) / 100) : clamp01(parseFloat(raw) / 255)
  const r = channel(parts[0]!)
  const g = channel(parts[1]!)
  const b = channel(parts[2]!)
  const aRaw = parts[3]
  const a =
    aRaw === undefined
      ? 1
      : aRaw.endsWith('%')
        ? clamp01(parseFloat(aRaw) / 100)
        : clamp01(parseFloat(aRaw))
  if ([r, g, b].some(Number.isNaN)) return null
  return { rgb: [r, g, b], a }
}

/**
 * Parse `oklch(L C H)` / `oklch(L C H / A)` and convert to sRGB via oklab.
 * (Björn Ottosson's oklab → linear-sRGB matrix, then sRGB gamma.)
 */
function parseOklch(str: string): Rgba01 | null {
  const inside = str.slice(str.indexOf('(') + 1, str.lastIndexOf(')'))
  const [main, alphaPart] = inside.split('/')
  const parts = main!.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 3) return null

  const lRaw = parts[0]!
  const L = lRaw.endsWith('%') ? parseFloat(lRaw) / 100 : parseFloat(lRaw)
  const C = parseFloat(parts[1]!)
  const hRaw = parts[2]!
  const H = (hRaw.endsWith('deg') ? parseFloat(hRaw) : parseFloat(hRaw)) * (Math.PI / 180)
  if ([L, C, H].some(Number.isNaN)) return null

  const a = C * Math.cos(H)
  const b = C * Math.sin(H)

  // oklab → LMS (cubed) → linear sRGB
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_

  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s

  const gamma = (c: number): number => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
    return clamp01(v)
  }

  const alpha =
    alphaPart === undefined
      ? 1
      : alphaPart.trim().endsWith('%')
        ? clamp01(parseFloat(alphaPart) / 100)
        : clamp01(parseFloat(alphaPart))

  return { rgb: [gamma(lr), gamma(lg), gamma(lb)], a: Number.isNaN(alpha) ? 1 : alpha }
}
