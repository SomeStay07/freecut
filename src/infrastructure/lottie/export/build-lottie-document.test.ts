import { describe, it, expect } from 'vitest'
import type { ShapeItem, TextItem, VideoItem, TimelineItem } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import { buildLottieDocument } from './build-lottie-document'
import type { LottieGroup, LottieShapeLayer, LottieShapePath } from './lottie-schema'

function rect(partial: Partial<ShapeItem> = {}): ShapeItem {
  return {
    id: 's1',
    trackId: 't1',
    from: 0,
    durationInFrames: 30,
    label: 'Rect',
    type: 'shape',
    shapeType: 'rectangle',
    fillColor: '#ff0000',
    transform: { x: 0, y: 0, width: 100, height: 50 },
    ...partial,
  }
}

const CANVAS = { fps: 30, width: 200, height: 100 }

describe('buildLottieDocument', () => {
  it('emits a shape layer with a centered static position', () => {
    const { document, warnings } = buildLottieDocument([rect()], CANVAS)
    expect(warnings).toHaveLength(0)
    expect(document.w).toBe(200)
    expect(document.op).toBe(30)
    expect(document.layers).toHaveLength(1)

    const layer = document.layers[0]! as LottieShapeLayer
    expect(layer.ty).toBe(4)
    expect(layer.ind).toBe(1)
    expect(layer.ip).toBe(0)
    expect(layer.op).toBe(30)
    // Anchor default = box center; a shape at offset (0,0) lands at canvas center.
    expect(layer.ks.a).toEqual({ a: 0, k: [50, 25] })
    expect(layer.ks.p).toEqual({ a: 0, k: [100, 50] })

    const group = layer.shapes[0] as LottieGroup
    expect(group.ty).toBe('gr')
    const types = group.it.map((el) => el.ty)
    expect(types).toEqual(['rc', 'fl', 'tr']) // no stroke
  })

  it('adds a stroke element only when a stroke is set', () => {
    const { document } = buildLottieDocument(
      [rect({ strokeColor: '#000000', strokeWidth: 4 })],
      CANVAS,
    )
    const group = (document.layers[0]! as LottieShapeLayer).shapes[0] as LottieGroup
    expect(group.it.map((el) => el.ty)).toEqual(['rc', 'fl', 'st', 'tr'])
  })

  it('converts opacity and x keyframes into animated transform tracks', () => {
    const keyframes: Record<string, ItemKeyframes> = {
      s1: {
        itemId: 's1',
        properties: [
          {
            property: 'opacity',
            keyframes: [
              { id: 'a', frame: 0, value: 0, easing: 'linear' },
              { id: 'b', frame: 30, value: 1, easing: 'linear' },
            ],
          },
          {
            property: 'x',
            keyframes: [
              { id: 'c', frame: 0, value: 0, easing: 'linear' },
              { id: 'd', frame: 30, value: 50, easing: 'linear' },
            ],
          },
        ],
      },
    }
    const { document } = buildLottieDocument([rect()], { ...CANVAS, keyframes })
    const ks = document.layers[0]!.ks

    // Opacity animates 0 → 100 (%).
    expect(ks.o.a).toBe(1)
    if (ks.o.a !== 1) throw new Error('expected animated opacity')
    expect(ks.o.k[0]!.s).toEqual([0])
    expect(ks.o.k[1]!.s).toEqual([100])

    // Position splits; x animates, y stays static.
    expect('s' in ks.p && ks.p.s).toBe(true)
    if (!('s' in ks.p)) throw new Error('expected split position')
    if (ks.p.x.a !== 1) throw new Error('expected animated x')
    expect(ks.p.x.k[0]!.s).toEqual([100]) // offsetX(100) + 0
    expect(ks.p.x.k[1]!.s).toEqual([150]) // offsetX(100) + 50
  })

  it('skips non-shape items with a warning', () => {
    const video: VideoItem = {
      id: 'v1',
      trackId: 't1',
      from: 0,
      durationInFrames: 60,
      label: 'Clip',
      type: 'video',
      src: 'blob:x',
    }
    const items: TimelineItem[] = [video, rect()]
    const { document, warnings } = buildLottieDocument(items, CANVAS)
    expect(document.layers).toHaveLength(1)
    expect(warnings.some((w) => w.code === 'unsupported-item-type' && w.itemId === 'v1')).toBe(true)
    // Comp out-point still spans the skipped video's duration.
    expect(document.op).toBe(60)
  })

  it('emits a text layer with a font descriptor', () => {
    const text: TextItem = {
      id: 'txt',
      trackId: 't1',
      from: 0,
      durationInFrames: 60,
      label: 'Title',
      type: 'text',
      text: 'Hello',
      color: '#ffffff',
      fontSize: 48,
      transform: { x: 0, y: 0, width: 300, height: 80 },
    }
    const { document } = buildLottieDocument([text], { ...CANVAS, fontName: 'Poppins' })
    const layer = document.layers[0]!
    expect(layer.ty).toBe(5)
    if (layer.ty !== 5) throw new Error('expected text layer')
    const doc = layer.t.d.k[0]!.s
    expect(doc.t).toBe('Hello')
    expect(doc.f).toBe('Poppins')
    expect(doc.s).toBe(48)
    expect(doc.j).toBe(2) // centered
    expect(doc.fc).toEqual([1, 1, 1]) // white
    // Document declares the font so players can resolve it.
    expect(document.fonts?.list[0]?.fName).toBe('Poppins')
  })

  it('round-trips pen-tool path vertices through the Lottie bezier', () => {
    const pathShape = rect({
      shapeType: 'path',
      transform: { x: 0, y: 0, width: 100, height: 80 },
      pathVertices: [
        { position: [0, 0], inHandle: [0, 0], outHandle: [0.1, 0] },
        { position: [1, 0.25], inHandle: [-0.1, 0], outHandle: [0, 0] },
        { position: [0.5, 1], inHandle: [0, 0], outHandle: [0, 0] },
      ],
    })
    const { document } = buildLottieDocument([pathShape], CANVAS)
    const group = (document.layers[0]! as LottieShapeLayer).shapes[0] as LottieGroup
    const sh = group.it[0] as LottieShapePath
    expect(sh.ty).toBe('sh')

    const bezier = sh.ks.k
    // Vertices are the normalized positions scaled by the box.
    expect(bezier.v).toEqual([
      [0, 0],
      [100, 20],
      [50, 80],
    ])
    // Recover normalized positions → equals the input.
    const recovered = bezier.v.map(([x, y]) => [x / 100, y / 80])
    expect(recovered[0]).toEqual([0, 0])
    expect(recovered[1]).toEqual([1, 0.25])
    expect(recovered[2]).toEqual([0.5, 1])
    expect(bezier.c).toBe(true)
  })
})
