/**
 * Lottie text layer (`ty:5`) → FreeCut `TextItem` fields (the inverse of
 * `../export/text.ts`).
 *
 * The exporter emits a single-line, center-justified text layer whose first
 * text-document keyframe carries the string, font name, size, and fill color.
 * FreeCut has no glyph outlines, so only that document is recovered; the box
 * width/height (dropped on export) is estimated from the string for layout.
 */
import type { ReaderLayer } from './lottie-reader-schema'
import { lottieColorToHex } from './color-from-lottie'

export interface InvertedText {
  text: string
  color: string
  fontSize: number
  /** Baseline nudge folded into the y offset (mirrors the exporter). */
  baselineAdjust: number
  /** Estimated layout box (the exporter didn't store one). */
  width: number
  height: number
}

export function invertText(layer: ReaderLayer): InvertedText {
  const doc = layer.t?.d?.k?.[0]?.s ?? {}
  const text = doc.t ?? ''
  const fontSize = doc.s ?? 48
  const color = lottieColorToHex(doc.fc, 100)
  // The longest line drives the estimated width; ~0.6em per glyph is a rough
  // single-weight average, good enough for an initial editable box.
  const longestLine = text.split('\n').reduce((max, line) => Math.max(max, line.length), 1)
  const lineCount = Math.max(1, text.split('\n').length)
  return {
    text,
    color,
    fontSize,
    baselineAdjust: fontSize * 0.35,
    width: Math.max(1, Math.round(longestLine * fontSize * 0.6)),
    height: Math.max(1, Math.round(lineCount * fontSize * 1.2)),
  }
}
