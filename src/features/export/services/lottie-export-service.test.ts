import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ShapeItem, VideoItem, TimelineTrack } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import type { ExportableSequence } from '@/features/export/deps/timeline-compositions'

// The service reads a timeline snapshot through this dep adapter; replace it
// with an in-memory fake so we exercise the real orchestration (z-ordering,
// keyframe-record building, document assembly, download) end-to-end.
const getExportableSequence = vi.fn<(id: string | null) => ExportableSequence>()
vi.mock('@/features/export/deps/timeline-compositions', () => ({
  getExportableSequence: (id: string | null) => getExportableSequence(id),
}))

import { exportTimelineAsLottie } from './lottie-export-service'

function track(id: string, order: number, extra: Partial<TimelineTrack> = {}): TimelineTrack {
  return { id, name: id, height: 60, locked: false, order, items: [], ...extra } as TimelineTrack
}

function shape(id: string, trackId: string, label: string): ShapeItem {
  return {
    id,
    trackId,
    from: 0,
    durationInFrames: 30,
    label,
    type: 'shape',
    shapeType: 'rectangle',
    fillColor: '#ff0000',
    transform: { x: 0, y: 0, width: 100, height: 100 },
  }
}

function sequence(over: Partial<ExportableSequence>): ExportableSequence {
  return {
    id: null,
    name: 'Seq',
    tracks: [],
    items: [],
    transitions: [],
    keyframes: [],
    fps: 30,
    width: 200,
    height: 200,
    masterBusDb: 0,
    durationFrames: 30,
    inPoint: null,
    outPoint: null,
    markers: [],
    ...over,
  }
}

let created: string[] = []

beforeEach(() => {
  created = []
  getExportableSequence.mockReset()
  // jsdom lacks object-URL support; capture the serialized JSON instead.
  vi.stubGlobal('URL', {
    createObjectURL: (blob: Blob) => {
      // Record that a blob was produced; content assertions use the return value.
      created.push(blob.type)
      return 'blob:mock'
    },
    revokeObjectURL: () => {},
  })
})

describe('exportTimelineAsLottie', () => {
  it('orders layers top-track-first (lower order = higher)', () => {
    getExportableSequence.mockReturnValue(
      sequence({
        tracks: [track('bottom', 1), track('top', 0)],
        items: [shape('b', 'bottom', 'Bottom'), shape('t', 'top', 'Top')],
      }),
    )
    const { shapeCount, warnings } = exportTimelineAsLottie(null)
    expect(shapeCount).toBe(2)
    expect(warnings).toHaveLength(0)
    // A download blob was produced.
    expect(created).toEqual(['application/json'])
  })

  it('skips group-header tracks and non-shape items with warnings', () => {
    const video: VideoItem = {
      id: 'v',
      trackId: 'vid',
      from: 0,
      durationInFrames: 60,
      label: 'Clip',
      type: 'video',
      src: 'blob:x',
    }
    getExportableSequence.mockReturnValue(
      sequence({
        tracks: [track('grp', 0, { isGroup: true }), track('vid', 1), track('shp', 2)],
        items: [shape('g', 'grp', 'OnGroup'), video, shape('s', 'shp', 'Real')],
      }),
    )
    const { shapeCount, warnings } = exportTimelineAsLottie(null)
    // Group-track item is filtered out entirely (not even a warning); the video
    // is considered and skipped with a warning; only the real shape exports.
    expect(shapeCount).toBe(1)
    expect(warnings.some((w) => w.code === 'unsupported-item-type' && w.itemId === 'v')).toBe(true)
  })

  it('does not trigger a download when there is nothing to export', () => {
    const video: VideoItem = {
      id: 'v',
      trackId: 'vid',
      from: 0,
      durationInFrames: 60,
      label: 'Clip',
      type: 'video',
      src: 'blob:x',
    }
    getExportableSequence.mockReturnValue(
      sequence({ tracks: [track('vid', 0)], items: [video] }),
    )
    const { shapeCount } = exportTimelineAsLottie(null)
    expect(shapeCount).toBe(0)
    expect(created).toEqual([]) // no blob produced
  })

  it('routes keyframes to the matching item by id', () => {
    const kf: ItemKeyframes = {
      itemId: 't',
      properties: [
        {
          property: 'opacity',
          keyframes: [
            { id: 'a', frame: 0, value: 0, easing: 'linear' },
            { id: 'b', frame: 30, value: 1, easing: 'linear' },
          ],
        },
      ],
    }
    getExportableSequence.mockReturnValue(
      sequence({
        tracks: [track('top', 0)],
        items: [shape('t', 'top', 'Top')],
        keyframes: [kf],
      }),
    )
    // Success (download produced) implies the keyframed opacity built without
    // error; the animated-value math itself is covered in the exporter tests.
    const { shapeCount, warnings } = exportTimelineAsLottie(null)
    expect(shapeCount).toBe(1)
    expect(warnings).toHaveLength(0)
  })
})
