/**
 * TextItem → Lottie text layer (`ty:5`).
 *
 * Emits a single-line, center-justified text layer plus the font descriptor the
 * document's `fonts.list` needs. Rendering relies on the named font being
 * registered with the player (`ensureLottieFont`) — FreeCut has no glyph
 * outlines, so this is the font-by-name path (standard for the LottieFiles
 * ecosystem). Vertical centering is approximated from the font size.
 */
import type { TextItem } from '@/types/timeline'
import type { Keyframe } from '@/types/keyframe'
import { parseCssColorToRgba01 } from './color'
import { buildPositionProperty, buildScalarProperty } from './keyframes'
import type { LottieFont, LottieTextLayer, LottieTransform } from './lottie-schema'

export interface TextLayerContext {
  index: number
  centerX: number
  centerY: number
  fontName: string
  keyframes: {
    x?: Keyframe[]
    y?: Keyframe[]
    rotation?: Keyframe[]
    opacity?: Keyframe[]
  }
}

export function creatorFontDescriptor(fontName: string): LottieFont {
  return { fName: fontName, fFamily: fontName, fStyle: 'Regular', fWeight: '400', ascent: 75 }
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

export function buildTextLayer(item: TextItem, ctx: TextLayerContext): LottieTextLayer {
  const t = item.transform ?? {}
  const fontSize = item.fontSize ?? 48
  const baseX = t.x ?? 0
  const baseY = t.y ?? 0
  const baseRotation = t.rotation ?? 0
  const baseOpacity = t.opacity ?? 1
  // Nudge the baseline so a single line sits roughly centered on the item's y.
  const baselineAdjust = fontSize * 0.35
  const { rgb } = parseCssColorToRgba01(item.color)

  const ks: LottieTransform = {
    // Text origin is the baseline; center justification handles horizontal
    // centering, so the layer anchor stays at the origin.
    a: { a: 0, k: [0, 0] },
    p: buildPositionProperty(
      ctx.keyframes.x,
      ctx.keyframes.y,
      baseX,
      baseY,
      ctx.centerX,
      ctx.centerY + baselineAdjust,
      item.from,
    ),
    s: { a: 0, k: [100, 100] },
    r: buildScalarProperty(ctx.keyframes.rotation, baseRotation, item.from),
    o: buildScalarProperty(ctx.keyframes.opacity, baseOpacity, item.from, (v) => clamp01(v) * 100),
  }

  return {
    ddd: 0,
    ind: ctx.index,
    ty: 5,
    nm: item.label || 'Text',
    sr: 1,
    ks,
    ao: 0,
    t: {
      d: {
        k: [
          {
            t: 0,
            s: {
              s: fontSize,
              f: ctx.fontName,
              t: item.text,
              j: 2,
              tr: 0,
              lh: fontSize * 1.2,
              ls: 0,
              fc: rgb,
            },
          },
        ],
      },
      p: {},
      m: { g: 1, a: { a: 0, k: [0, 0] } },
      a: [],
    },
    ip: item.from,
    op: item.from + item.durationInFrames,
    st: item.from,
    bm: 0,
  }
}
