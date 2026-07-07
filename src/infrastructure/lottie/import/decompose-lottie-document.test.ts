import { describe, it, expect } from 'vitest'
import type { ShapeItem, TextItem } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import { buildLottieDocument } from '../export/build-lottie-document'
import { decomposeLottieDocument } from './decompose-lottie-document'

/** Deterministic id factory so decomposed ids are stable across a test run. */
function counterIds(): () => string {
  let n = 0
  return () => `id${n++}`
}

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

function decompose(doc: unknown) {
  return decomposeLottieDocument(doc, { makeId: counterIds() })
}

describe('decomposeLottieDocument — shape round-trips', () => {
  it('recovers a rectangle with its exact box, fill, and offset position', () => {
    const { document } = buildLottieDocument(
      [rect({ transform: { x: 20, y: -10, width: 100, height: 50 } })],
      CANVAS,
    )
    const scene = decompose(document)

    expect(scene.width).toBe(200)
    expect(scene.height).toBe(100)
    expect(scene.items).toHaveLength(1)
    const item = scene.items[0] as ShapeItem
    expect(item.type).toBe('shape')
    expect(item.shapeType).toBe('rectangle')
    expect(item.fillColor).toBe('#ff0000')
    expect(item.transform?.width).toBe(100)
    expect(item.transform?.height).toBe(50)
    expect(item.transform?.x).toBeCloseTo(20, 4)
    expect(item.transform?.y).toBeCloseTo(-10, 4)
    // One track per layer, no folders.
    expect(scene.tracks).toHaveLength(1)
    expect(scene.tracks[0]!.isGroup).toBeFalsy()
    expect(scene.items[0]!.trackId).toBe(scene.tracks[0]!.id)
  })

  it('recovers a stroke when present', () => {
    const { document } = buildLottieDocument(
      [rect({ strokeColor: '#000000', strokeWidth: 4 })],
      CANVAS,
    )
    const item = decompose(document).items[0] as ShapeItem
    expect(item.strokeColor).toBe('#000000')
    expect(item.strokeWidth).toBe(4)
  })

  it('recovers an ellipse box', () => {
    const { document } = buildLottieDocument(
      [rect({ shapeType: 'ellipse', transform: { x: 0, y: 0, width: 80, height: 40 } })],
      CANVAS,
    )
    const item = decompose(document).items[0] as ShapeItem
    expect(item.shapeType).toBe('ellipse')
    expect(item.transform?.width).toBe(80)
    expect(item.transform?.height).toBe(40)
  })

  it('recovers a horizontal flip from negative scale', () => {
    const { document } = buildLottieDocument(
      [rect({ transform: { x: 0, y: 0, width: 100, height: 50, flipHorizontal: true } })],
      CANVAS,
    )
    const item = decompose(document).items[0] as ShapeItem
    expect(item.transform?.flipHorizontal).toBe(true)
    expect(item.transform?.flipVertical).toBeFalsy()
  })

  it('round-trips pen-tool path vertices (visually exact)', () => {
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
    const item = decompose(document).items[0] as ShapeItem
    expect(item.shapeType).toBe('path')
    expect(item.transform?.width).toBeCloseTo(100, 4)
    expect(item.transform?.height).toBeCloseTo(80, 4)
    const verts = item.pathVertices!
    expect(verts[0]!.position[0]).toBeCloseTo(0, 4)
    expect(verts[0]!.position[1]).toBeCloseTo(0, 4)
    expect(verts[1]!.position[0]).toBeCloseTo(1, 4)
    expect(verts[1]!.position[1]).toBeCloseTo(0.25, 4)
    expect(verts[2]!.position[0]).toBeCloseTo(0.5, 4)
    expect(verts[2]!.position[1]).toBeCloseTo(1, 4)
  })
})

describe('decomposeLottieDocument — keyframe round-trips', () => {
  it('recovers opacity and x keyframe tracks with correct values', () => {
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
    const scene = decompose(document)

    expect(scene.keyframes).toHaveLength(1)
    const props = scene.keyframes[0]!.properties
    const opacity = props.find((p) => p.property === 'opacity')!
    expect(opacity.keyframes.map((k) => k.value)).toEqual([0, 1])
    expect(opacity.keyframes.map((k) => k.frame)).toEqual([0, 30])
    expect(opacity.keyframes[0]!.easing).toBe('linear')

    const x = props.find((p) => p.property === 'x')!
    expect(x.keyframes.map((k) => k.value)).toEqual([0, 50])
    expect(x.keyframes.map((k) => k.frame)).toEqual([0, 30])
  })

  it('recovers a cubic-bezier easing curve', () => {
    const keyframes: Record<string, ItemKeyframes> = {
      s1: {
        itemId: 's1',
        properties: [
          {
            property: 'rotation',
            keyframes: [
              {
                id: 'a',
                frame: 0,
                value: 0,
                easing: 'cubic-bezier',
                easingConfig: {
                  type: 'cubic-bezier',
                  bezier: { x1: 0.2, y1: 0.1, x2: 0.8, y2: 0.9 },
                },
              },
              { id: 'b', frame: 30, value: 90, easing: 'linear' },
            ],
          },
        ],
      },
    }
    const { document } = buildLottieDocument([rect()], { ...CANVAS, keyframes })
    const scene = decompose(document)
    const rotation = scene.keyframes[0]!.properties.find((p) => p.property === 'rotation')!
    expect(rotation.keyframes.map((k) => k.value)).toEqual([0, 90])
    const first = rotation.keyframes[0]!
    expect(first.easing).toBe('cubic-bezier')
    expect(first.easingConfig?.bezier).toEqual({ x1: 0.2, y1: 0.1, x2: 0.8, y2: 0.9 })
  })
})

describe('decomposeLottieDocument — text round-trips', () => {
  it('recovers text content, color, size, and centered position', () => {
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
    const item = decompose(document).items[0] as TextItem
    expect(item.type).toBe('text')
    expect(item.text).toBe('Hello')
    expect(item.color).toBe('#ffffff')
    expect(item.fontSize).toBe(48)
    expect(item.transform?.x).toBeCloseTo(0, 4)
    expect(item.transform?.y).toBeCloseTo(0, 4)
  })
})

describe('decomposeLottieDocument — precomp folders round-trip', () => {
  it('reconstructs a folder track with nested children in order', () => {
    const a = rect({ id: 'a', label: 'A' })
    const b = rect({ id: 'b', label: 'B' })
    const top = rect({ id: 'top', label: 'Top' })
    const { document } = buildLottieDocument([a, b, top], {
      ...CANVAS,
      tree: [
        {
          type: 'folder',
          name: 'Group 1',
          children: [
            { type: 'layer', item: a },
            { type: 'layer', item: b },
          ],
        },
        { type: 'layer', item: top },
      ],
    })
    const scene = decompose(document)

    // 1 folder + 3 leaf tracks; global DFS order.
    expect(scene.tracks).toHaveLength(4)
    const [folder, trackA, trackB, trackTop] = scene.tracks
    expect(folder!.isGroup).toBe(true)
    expect(folder!.name).toBe('Group 1')
    expect(folder!.order).toBe(0)
    expect(folder!.parentTrackId).toBeUndefined()

    expect(trackA!.parentTrackId).toBe(folder!.id)
    expect(trackB!.parentTrackId).toBe(folder!.id)
    expect(trackTop!.parentTrackId).toBeUndefined()
    expect([trackA!.order, trackB!.order, trackTop!.order]).toEqual([1, 2, 3])

    // Items land on their leaf tracks (folders carry none).
    expect(scene.items).toHaveLength(3)
    expect(scene.items.map((i) => i.label)).toEqual(['A', 'B', 'Top'])
    expect(scene.items.find((i) => i.label === 'A')!.trackId).toBe(trackA!.id)
  })

  it('nests folders as nested precomps', () => {
    const leaf = rect({ id: 'leaf', label: 'Leaf' })
    const { document } = buildLottieDocument([leaf], {
      ...CANVAS,
      tree: [
        {
          type: 'folder',
          name: 'Outer',
          children: [{ type: 'folder', name: 'Inner', children: [{ type: 'layer', item: leaf }] }],
        },
      ],
    })
    const scene = decompose(document)
    expect(scene.tracks.map((t) => t.name)).toEqual(['Outer', 'Inner', 'Leaf'])
    const [outer, inner, leafTrack] = scene.tracks
    expect(outer!.isGroup).toBe(true)
    expect(inner!.isGroup).toBe(true)
    expect(inner!.parentTrackId).toBe(outer!.id)
    expect(leafTrack!.parentTrackId).toBe(inner!.id)
  })
})

describe('decomposeLottieDocument — warnings & edge cases', () => {
  it('warns and skips unknown layer types', () => {
    const doc = {
      v: '5.9.6',
      fr: 30,
      ip: 0,
      op: 30,
      w: 200,
      h: 100,
      layers: [{ ty: 2, nm: 'Image', ip: 0, op: 30 }],
      assets: [],
    }
    const scene = decompose(doc)
    expect(scene.items).toHaveLength(0)
    expect(scene.warnings.some((w) => w.code === 'unsupported-layer-type')).toBe(true)
  })

  it('warns on an empty document', () => {
    const scene = decompose({
      v: '5.9.6',
      fr: 30,
      ip: 0,
      op: 30,
      w: 200,
      h: 100,
      layers: [],
      assets: [],
    })
    expect(scene.warnings.some((w) => w.code === 'empty-document')).toBe(true)
  })

  it('handles legacy animated position (no `a` flag, `e` end-values) without NaN', () => {
    // Mirrors real-world files (bodymovin < 5.5): an animated position where `a`
    // is omitted and the value array holds keyframe OBJECTS with `s`/`e`, plus a
    // trailing time-only keyframe. Trusting `a` treated these as a static number
    // vector → `keyframeObject - offset` = NaN → the renderer hung.
    const doc = {
      v: '5.5.2',
      fr: 30,
      ip: 0,
      op: 30,
      w: 400,
      h: 400,
      assets: [],
      layers: [
        {
          ty: 4,
          nm: 'Dot',
          ip: 0,
          op: 30,
          ks: {
            a: { a: 0, k: [196, 266, 0] },
            p: {
              k: [
                {
                  t: 0,
                  s: [295, 109, 0],
                  e: [35, 109, 0],
                  i: { x: 0.833, y: 0.833 },
                  o: { x: 0.823, y: 0 },
                },
                { t: 16 },
              ],
            },
            s: { a: 0, k: [100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
          shapes: [
            {
              ty: 'gr',
              it: [
                { ty: 'el', p: { a: 0, k: [4.7, 4.7] }, s: { a: 0, k: [9.4, 9.4] } },
                { ty: 'fl', c: { a: 0, k: [1, 0, 0] }, o: { a: 0, k: 100 } },
                { ty: 'tr' },
              ],
            },
          ],
        },
      ],
    }
    const scene = decompose(doc)
    const item = scene.items[0] as ShapeItem
    // No NaN anywhere in the transform.
    for (const v of Object.values(item.transform ?? {})) {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
    }
    // The animation is recovered as an x keyframe track with finite values.
    const x = scene.keyframes[0]?.properties.find((p) => p.property === 'x')
    expect(x).toBeDefined()
    expect(x!.keyframes.length).toBe(2)
    for (const k of x!.keyframes) expect(Number.isFinite(k.value)).toBe(true)
    // The trailing `{t:16}` keyframe recovers its value from the previous `e`.
    expect(x!.keyframes[1]!.frame).toBe(16)
  })

  it('warns when a group references a missing precomp asset', () => {
    const doc = {
      v: '5.9.6',
      fr: 30,
      ip: 0,
      op: 30,
      w: 200,
      h: 100,
      layers: [{ ty: 0, nm: 'Ghost', refId: 'nope', ip: 0, op: 30 }],
      assets: [],
    }
    const scene = decompose(doc)
    expect(scene.warnings.some((w) => w.code === 'missing-asset')).toBe(true)
    expect(scene.tracks).toHaveLength(0)
  })
})
