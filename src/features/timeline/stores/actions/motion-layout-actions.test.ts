import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useProjectStore } from '@/features/timeline/deps/projects'
import { useEditorStore } from '@/shared/state/editor'
import {
  makeTimelineAudioItem,
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from '../items-store'
import { useKeyframesStore } from '../keyframes-store'
import { useCompositionsStore } from '../compositions-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import {
  createDefaultMotionLayoutSettings,
  motionLayoutDepthProperty,
} from '../../utils/motion-layout'
import { applyMotionLayout, updateMotionLayout } from './motion-layout-actions'

describe('applyMotionLayout', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useTimelineSettingsStore.getState().setFps(30)
    useEditorStore.setState({ linkedSelectionEnabled: false })
    useProjectStore.getState().setCurrentProject({
      id: 'project-motion-layout',
      name: 'Motion layout test',
      description: '',
      createdAt: 0,
      updatedAt: 0,
      duration: 300,
      metadata: { width: 1920, height: 1080, fps: 30 },
    })
    useItemsStore
      .getState()
      .setTracks([
        makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
        makeTimelineTrack({ id: 'v2', name: 'V2', kind: 'video', order: 1 }),
      ])
    useItemsStore
      .getState()
      .setItems([
        makeTimelineVideoItem({ id: 'a', trackId: 'v1', durationInFrames: 300, label: 'A' }),
        makeTimelineVideoItem({ id: 'b', trackId: 'v2', durationInFrames: 300, label: 'B' }),
      ])
    useKeyframesStore.getState().setKeyframes([
      {
        itemId: 'a',
        properties: [
          {
            property: 'x',
            keyframes: [{ id: 'source-kf', frame: 0, value: 42, easing: 'linear' }],
          },
        ],
      },
    ])
  })

  it('creates isolated slot compositions in one undoable command', () => {
    const result = applyMotionLayout({
      itemIds: ['a', 'b'],
      chainOrder: [['a'], ['b']],
      templateId: 'grid-reveal',
      settings: createDefaultMotionLayoutSettings('grid-reveal'),
      name: 'Motion Layout · Grid Reveal',
    })

    expect(result?.type).toBe('composition')
    expect(
      useItemsStore.getState().items.filter((item) => item.type === 'composition'),
    ).toHaveLength(1)
    expect(useCompositionsStore.getState().compositions).toHaveLength(3)

    const parent = useCompositionsStore
      .getState()
      .compositions.find((composition) => composition.id === result?.compositionId)
    expect(parent?.motionLayout?.templateId).toBe('grid-reveal')
    expect(parent?.items).toHaveLength(2)
    expect(parent?.items.every((item) => item.type === 'composition')).toBe(true)
    expect(
      parent?.items.every((item) => item.type !== 'composition' || item.compositionFit === 'cover'),
    ).toBe(true)
    expect(parent?.keyframes.map((entry) => entry.itemId).sort()).toEqual(
      parent?.items.map((item) => item.id).sort(),
    )

    const sourceSlot = useCompositionsStore
      .getState()
      .compositions.find((composition) =>
        composition.keyframes.some((entry) =>
          entry.properties.some((property) =>
            property.keyframes.some((keyframe) => keyframe.id === 'source-kf'),
          ),
        ),
      )
    expect(sourceSlot).toBeDefined()

    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    useTimelineCommandStore.getState().undo()
    expect(
      useItemsStore
        .getState()
        .items.map((item) => item.id)
        .sort(),
    ).toEqual(['a', 'b'])
    expect(useCompositionsStore.getState().compositions).toHaveLength(0)
  })

  it('recompiles an existing layout without replacing edited slot compositions', () => {
    const result = applyMotionLayout({
      itemIds: ['a', 'b'],
      chainOrder: [['a'], ['b']],
      templateId: 'grid-reveal',
      settings: createDefaultMotionLayoutSettings('grid-reveal'),
      name: 'Motion Layout · Grid Reveal',
    })
    const parent = useCompositionsStore.getState().getComposition(result!.compositionId)
    const originalSlotIds = parent!.motionLayout!.slots.map((slot) => slot.compositionId)
    const editedSlot = useCompositionsStore.getState().getComposition(originalSlotIds[0]!)!
    useCompositionsStore.getState().updateComposition(editedSlot.id, {
      items: editedSlot.items.map((item, index) =>
        index === 0 ? { ...item, label: 'Edited source' } : item,
      ),
    })
    const undoDepth = useTimelineCommandStore.getState().undoStack.length
    const settings = {
      ...createDefaultMotionLayoutSettings('stack-slide'),
      durationSeconds: 7,
    }

    const updated = updateMotionLayout({
      compositionId: parent!.id,
      slotCompositionIds: originalSlotIds.toReversed(),
      templateId: 'stack-slide',
      settings,
      frameAspect: '1:1',
      frameWidth: 1080,
      frameHeight: 1080,
      name: 'Motion Layout · Stack Slide',
    })

    expect(updated?.compositionId).toBe(parent?.id)
    expect(useCompositionsStore.getState().compositions).toHaveLength(3)
    const updatedParent = useCompositionsStore.getState().getComposition(parent!.id)
    expect(updatedParent?.motionLayout?.templateId).toBe('stack-slide')
    expect(updatedParent?.motionLayout?.slotOrder).toEqual(originalSlotIds.toReversed())
    expect(updatedParent?.motionLayout?.slots.map((slot) => slot.compositionId)).toEqual(
      originalSlotIds,
    )
    expect(updatedParent?.durationInFrames).toBe(210)
    expect(updatedParent).toMatchObject({
      width: 1080,
      height: 1080,
      motionLayout: { frameAspect: '1:1' },
    })
    expect(updated).toMatchObject({ compositionWidth: 1080, compositionHeight: 1080 })
    expect(useCompositionsStore.getState().getComposition(editedSlot.id)?.items[0]?.label).toBe(
      'Edited source',
    )
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(undoDepth + 1)

    useTimelineCommandStore.getState().undo()
    const restoredParent = useCompositionsStore.getState().getComposition(parent!.id)
    expect(restoredParent?.motionLayout?.templateId).toBe('grid-reveal')
    expect(useCompositionsStore.getState().getComposition(editedSlot.id)?.items[0]?.label).toBe(
      'Edited source',
    )
  })

  it('adds timeline sources to an existing layout by reference without consuming the originals', () => {
    const result = applyMotionLayout({
      itemIds: ['a', 'b'],
      chainOrder: [['a'], ['b']],
      templateId: 'grid-reveal',
      settings: createDefaultMotionLayoutSettings('grid-reveal'),
      name: 'Motion Layout · Grid Reveal',
    })
    const parent = useCompositionsStore.getState().getComposition(result!.compositionId)!
    const originalSlotIds = parent.motionLayout!.slotOrder!
    useItemsStore
      .getState()
      .setItems([
        ...useItemsStore.getState().items,
        makeTimelineVideoItem({ id: 'c', trackId: 'v2', durationInFrames: 240, label: 'C' }),
      ])

    updateMotionLayout({
      compositionId: parent.id,
      slotCompositionIds: [...originalSlotIds, 'c'],
      templateId: 'grid-reveal',
      settings: createDefaultMotionLayoutSettings('grid-reveal'),
      name: 'Motion Layout · Grid Reveal',
    })

    expect(useItemsStore.getState().itemById.c?.label).toBe('C')
    const updatedParent = useCompositionsStore.getState().getComposition(parent.id)!
    expect(updatedParent.motionLayout?.slotOrder).toHaveLength(3)
    expect(updatedParent.motionLayout?.slotOrder).not.toContain('c')
    expect(updatedParent.motionLayout?.slots).toHaveLength(3)
    const addedSlotId = updatedParent.motionLayout?.slotOrder?.at(-1)
    expect(useCompositionsStore.getState().getComposition(addedSlotId!)?.items[0]?.label).toBe('C')
  })

  it('keeps linked audio inside its visual slot and leaves independent audio at the parent', () => {
    useItemsStore
      .getState()
      .setTracks([
        ...useItemsStore.getState().tracks,
        makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
        makeTimelineTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 3 }),
      ])
    useItemsStore.getState().setItems([
      ...useItemsStore
        .getState()
        .items.map((item) => (item.id === 'a' ? { ...item, linkedGroupId: 'linked-a' } : item)),
      makeTimelineAudioItem({
        id: 'a-audio',
        trackId: 'a1',
        durationInFrames: 300,
        label: 'A audio',
        linkedGroupId: 'linked-a',
      }),
      makeTimelineAudioItem({
        id: 'music',
        trackId: 'a2',
        durationInFrames: 300,
        label: 'Independent music',
      }),
    ])

    const result = applyMotionLayout({
      itemIds: ['a', 'b', 'music'],
      chainOrder: [['a'], ['b']],
      templateId: 'grid-reveal',
      settings: createDefaultMotionLayoutSettings('grid-reveal'),
      name: 'Motion Layout · Grid Reveal',
    })
    const compositions = useCompositionsStore.getState().compositions
    const parent = compositions.find((composition) => composition.id === result?.compositionId)
    const linkedSlot = compositions.find((composition) =>
      composition.items.some((item) => item.type === 'audio' && item.linkedGroupId === 'linked-a'),
    )

    expect(parent?.items.filter((item) => item.type === 'audio')).toHaveLength(1)
    expect(parent?.items.find((item) => item.type === 'audio')?.label).toBe('Independent music')
    expect(linkedSlot?.items.map((item) => item.type).sort()).toEqual(['audio', 'video'])
    expect(linkedSlot?.tracks.map((track) => track.kind).sort()).toEqual(['audio', 'video'])
    expect(
      parent?.items.find(
        (item) => item.type === 'composition' && item.compositionId === linkedSlot?.id,
      )?.label,
    ).toBe('A')
  })

  it('builds staggered cropped actors for stripe reveals', () => {
    const settings = createDefaultMotionLayoutSettings('stripe-reveal')
    settings.strips = 3
    const result = applyMotionLayout({
      itemIds: ['a', 'b'],
      chainOrder: [['a'], ['b']],
      templateId: 'stripe-reveal',
      settings,
      name: 'Motion Layout · Stripe Reveal',
    })
    const parent = useCompositionsStore
      .getState()
      .compositions.find((composition) => composition.id === result?.compositionId)

    const actors = parent?.items.filter((item) => item.type === 'composition') ?? []
    expect(actors).toHaveLength(6)
    expect(actors.every((item) => item.crop?.left !== undefined)).toBe(true)
    expect(parent?.keyframes).toHaveLength(6)
  })

  it('builds opposing cropped halves for split reveals', () => {
    const result = applyMotionLayout({
      itemIds: ['a', 'b'],
      chainOrder: [['a'], ['b']],
      templateId: 'split-reveal',
      settings: createDefaultMotionLayoutSettings('split-reveal'),
      name: 'Motion Layout · Split Reveal',
    })
    const parent = useCompositionsStore
      .getState()
      .compositions.find((composition) => composition.id === result?.compositionId)

    const actors = parent?.items.filter((item) => item.type === 'composition') ?? []
    expect(actors).toHaveLength(4)
    expect(actors.some((item) => item.crop?.left === 0.5)).toBe(true)
    expect(actors.some((item) => item.crop?.right === 0.5)).toBe(true)
  })

  it('adds a real animated shape mask for diagonal wipes', () => {
    const result = applyMotionLayout({
      itemIds: ['a', 'b'],
      chainOrder: [['a'], ['b']],
      templateId: 'diagonal-wipe',
      settings: createDefaultMotionLayoutSettings('diagonal-wipe'),
      name: 'Motion Layout · Diagonal Wipe',
    })
    const parent = useCompositionsStore
      .getState()
      .compositions.find((composition) => composition.id === result?.compositionId)
    const mask = parent?.items.find((item) => item.type === 'shape' && item.isMask)

    expect(mask).toBeDefined()
    expect(mask?.transform?.rotation).toBe(-20)
    expect(parent?.keyframes.find((entry) => entry.itemId === mask?.id)).toBeDefined()
    const maskTrack = parent?.tracks.find((track) => track.id === mask?.trackId)
    expect(maskTrack?.order).toBe(0)
  })

  it('adds projective corner pins to perspective layout actors', () => {
    useItemsStore
      .getState()
      .setTracks([
        ...useItemsStore.getState().tracks,
        makeTimelineTrack({ id: 'v3', name: 'V3', kind: 'video', order: 2 }),
        makeTimelineTrack({ id: 'v4', name: 'V4', kind: 'video', order: 3 }),
      ])
    useItemsStore
      .getState()
      .setItems([
        ...useItemsStore.getState().items,
        makeTimelineVideoItem({ id: 'c', trackId: 'v3', durationInFrames: 300, label: 'C' }),
        makeTimelineVideoItem({ id: 'd', trackId: 'v4', durationInFrames: 300, label: 'D' }),
      ])
    const result = applyMotionLayout({
      itemIds: ['a', 'b', 'c', 'd'],
      chainOrder: [['a'], ['b'], ['c'], ['d']],
      templateId: 'showcase-stream',
      settings: createDefaultMotionLayoutSettings('showcase-stream'),
      name: 'Motion Layout · Showcase Stream',
    })
    const parent = useCompositionsStore
      .getState()
      .compositions.find((composition) => composition.id === result?.compositionId)
    const actors = parent?.items.filter((item) => item.type === 'composition') ?? []

    expect(actors).toHaveLength(4)
    expect(actors.every((item) => item.cornerPin !== undefined)).toBe(true)
    expect(actors[0]?.cornerPin?.referenceWidth).toBe(1920)
    expect(actors[0]?.cornerPin?.topLeft[0]).toBeGreaterThan(0)
    expect(
      actors.every((item) =>
        item.effects?.some(
          (effect) =>
            effect.enabled &&
            effect.effect.type === 'gpu-effect' &&
            effect.effect.gpuEffectType === 'gpu-brightness',
        ),
      ),
    ).toBe(true)
    expect(
      parent?.keyframes
        .find((entry) => entry.itemId === actors[0]?.id)
        ?.properties.some(
          (property) => property.property === motionLayoutDepthProperty(actors[0]!.id),
        ),
    ).toBe(true)
  })
})
