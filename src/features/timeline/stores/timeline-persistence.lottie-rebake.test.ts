import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { LottieItem, ShapeItem, TimelineItem, VideoItem } from '@/types/timeline'
import type { ProjectTimeline } from '@/types/project'
import {
  buildLottieCompositionIndex,
  rebuildCreatorLottieWrapperSrcs,
} from './timeline-persistence'

/**
 * Phase 3 regression: a creator-Lottie wrapper's `src` is an in-memory blob URL
 * that dies on reload. On load it must be rebaked from the authoring
 * `kind:'lottie'` composition (the single source of truth) — and only for those
 * wrappers, never for regular imported Lotties.
 */

const star: ShapeItem = {
  id: 'star-1',
  trackId: 'lottie',
  from: 0,
  durationInFrames: 90,
  label: 'Star 1',
  type: 'shape',
  shapeType: 'star',
  fillColor: '#f59e0b',
  transform: { x: 0, y: 0, width: 200, height: 200 },
  points: 5,
  innerRadius: 0.5,
}

function lottieComp(
  kind: 'lottie' | 'timeline' | undefined,
): NonNullable<ProjectTimeline['compositions']>[number] {
  return {
    id: 'comp-1',
    name: 'Lottie',
    items: [star] as ProjectTimeline['items'],
    tracks: [] as ProjectTimeline['tracks'],
    keyframes: [],
    fps: 30,
    width: 512,
    height: 512,
    durationInFrames: 90,
    ...(kind && { kind }),
  }
}

function wrapper(overrides: Partial<LottieItem> = {}): LottieItem {
  return {
    id: 'wrap-1',
    trackId: 'v1',
    from: 0,
    durationInFrames: 90,
    label: 'Lottie',
    type: 'lottie',
    compositionId: 'comp-1',
    src: 'blob:dead-url',
    // Deliberately stale timing so a successful rebake is observable.
    frameRate: 24,
    totalFrames: 50,
    ...overrides,
  }
}

beforeEach(() => {
  let n = 0
  // jsdom doesn't implement createObjectURL; hand out a fresh, distinguishable url.
  URL.createObjectURL = vi.fn(() => `blob:fresh-${n++}`)
})

describe('buildLottieCompositionIndex', () => {
  it('indexes only kind:lottie compositions', () => {
    const index = buildLottieCompositionIndex([
      lottieComp('lottie'),
      { ...lottieComp('timeline'), id: 'comp-2' },
      { ...lottieComp(undefined), id: 'comp-3' },
    ])
    expect([...index.keys()]).toEqual(['comp-1'])
  })
})

describe('rebuildCreatorLottieWrapperSrcs', () => {
  it('rebakes a creator-lottie wrapper src and corrects its timing from the comp', () => {
    const index = buildLottieCompositionIndex([lottieComp('lottie')])
    const [rebaked] = rebuildCreatorLottieWrapperSrcs([wrapper()], index) as [LottieItem]

    expect(rebaked.src).toBe('blob:fresh-0')
    expect(rebaked.src).not.toBe('blob:dead-url')
    // Timing re-derived from the composition, not the stale persisted values.
    expect(rebaked.frameRate).toBe(30)
    expect(rebaked.totalFrames).toBe(90)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('leaves a wrapper untouched when its composition is not a creator-lottie', () => {
    // comp-1 is kind:timeline → excluded from the index → not rebaked.
    const index = buildLottieCompositionIndex([lottieComp('timeline')])
    const input = [wrapper()]
    const result = rebuildCreatorLottieWrapperSrcs(input, index)

    expect(result).toBe(input) // same reference — no rebuild happened
    expect((result[0] as LottieItem).src).toBe('blob:dead-url')
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('never touches non-lottie items', () => {
    const video: VideoItem = {
      id: 'vid-1',
      trackId: 'v1',
      from: 0,
      durationInFrames: 100,
      label: 'clip.mp4',
      type: 'video',
      src: 'blob:video',
      mediaId: 'media-1',
    }
    const index = buildLottieCompositionIndex([lottieComp('lottie')])
    const items: TimelineItem[] = [video]
    const result = rebuildCreatorLottieWrapperSrcs(items, index)

    expect(result).toBe(items)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('is a no-op when there are no creator-lottie comps', () => {
    const input = [wrapper()]
    const result = rebuildCreatorLottieWrapperSrcs(input, new Map())
    expect(result).toBe(input)
  })
})
