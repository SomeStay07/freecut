import type { CompositionItem, ShapeItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import type { ItemEffect } from '@/types/effects'
import type {
  MotionLayoutFrameAspect,
  MotionLayoutSettings,
  MotionLayoutTemplateId,
} from '@/types/motion-layout'
import { useItemsStore } from '../items-store'
import { useCompositionsStore, type SubComposition } from '../compositions-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { createPreCompMutation } from './composition-actions'
import { execute } from './shared'
import { DEFAULT_TRACK_HEIGHT } from '../../constants'
import { buildTransitionIndexes } from '../../utils/transition-indexes'
import { buildTransitionChains } from '../../utils/bento-layout'
import {
  buildMotionLayoutPlan,
  motionLayoutDepthEffectId,
  motionLayoutDepthProperty,
  MOTION_LAYOUT_TEMPLATE_BY_ID,
} from '../../utils/motion-layout'
import { getLinkedAudioCompanion } from '@/shared/utils/linked-media'

export interface ApplyMotionLayoutInput {
  itemIds: string[]
  chainOrder: string[][]
  templateId: MotionLayoutTemplateId
  settings: MotionLayoutSettings
  frameAspect?: MotionLayoutFrameAspect
  frameWidth?: number
  frameHeight?: number
  name: string
}

export interface UpdateMotionLayoutInput {
  compositionId: string
  slotCompositionIds: string[]
  templateId: MotionLayoutTemplateId
  settings: MotionLayoutSettings
  frameAspect?: MotionLayoutFrameAspect
  frameWidth?: number
  frameHeight?: number
  name: string
}

function createSlotTrack(index: number): TimelineTrack {
  return {
    id: crypto.randomUUID(),
    name: `Slot ${index + 1}`,
    kind: 'video',
    height: DEFAULT_TRACK_HEIGHT,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order: index,
    items: [],
  }
}

function clipItemToDuration(item: TimelineItem, durationInFrames: number): TimelineItem | null {
  if (item.from >= durationInFrames) return null
  const duration = Math.min(item.durationInFrames, durationInFrames - item.from)
  if (duration < 1) return null
  return { ...item, durationInFrames: duration }
}

function buildOrderedChains(
  parent: SubComposition,
  beforeVisualItems: TimelineItem[],
  requestedChainOrder: string[][],
): string[][] {
  const parentVisualItems = parent.items.filter((item) => item.type !== 'audio')
  const oldIdByNewId = new Map<string, string>()
  const pairCount = Math.min(beforeVisualItems.length, parentVisualItems.length)
  for (let index = 0; index < pairCount; index += 1) {
    oldIdByNewId.set(parentVisualItems[index]!.id, beforeVisualItems[index]!.id)
  }

  const desiredRank = new Map<string, number>()
  requestedChainOrder.flat().forEach((id, index) => desiredRank.set(id, index))
  const { transitionsByClipId } = buildTransitionIndexes(parent.transitions)
  const chains = buildTransitionChains(
    parentVisualItems.map((item) => item.id),
    transitionsByClipId,
  )

  return chains.toSorted((left, right) => {
    const leftRank = Math.min(
      ...left.map((id) => desiredRank.get(oldIdByNewId.get(id) ?? '') ?? Number.MAX_SAFE_INTEGER),
    )
    const rightRank = Math.min(
      ...right.map((id) => desiredRank.get(oldIdByNewId.get(id) ?? '') ?? Number.MAX_SAFE_INTEGER),
    )
    return leftRank - rightRank
  })
}

function buildSlotComposition(params: {
  parent: SubComposition
  chain: string[]
  slotTrack: TimelineTrack
  durationInFrames: number
}): { composition: SubComposition; wrapper: CompositionItem } | null {
  const { parent, chain, slotTrack, durationInFrames } = params
  const chainIdSet = new Set(chain)
  for (const item of parent.items) {
    if (!chainIdSet.has(item.id) || item.type === 'audio') continue
    const linkedAudio = getLinkedAudioCompanion(parent.items, item)
    if (linkedAudio) chainIdSet.add(linkedAudio.id)
  }
  const sourceItems = parent.items.filter((item) => chainIdSet.has(item.id))
  if (sourceItems.length === 0) return null
  const sourceVisualItems = sourceItems.filter((item) => item.type !== 'audio')

  const minFrom = Math.min(...sourceItems.map((item) => item.from))
  const sourceTrackIds = [...new Set(sourceItems.map((item) => item.trackId))]
  const sourceTrackById = new Map(parent.tracks.map((track) => [track.id, track]))
  const trackIdMapping = new Map<string, string>()
  const childTracks = sourceTrackIds.map((sourceTrackId, trackIndex) => {
    const nextId = crypto.randomUUID()
    trackIdMapping.set(sourceTrackId, nextId)
    const sourceTrack = sourceTrackById.get(sourceTrackId)
    return {
      ...(sourceTrack ?? {
        name: `Track ${trackIndex + 1}`,
        height: DEFAULT_TRACK_HEIGHT,
        locked: false,
        syncLock: true,
        visible: true,
        muted: false,
        solo: false,
        order: trackIndex,
        items: [],
      }),
      id: nextId,
      order: trackIndex,
      items: [],
    } satisfies TimelineTrack
  })

  const singleVisualItem = sourceVisualItems.length === 1
  const childItems = sourceItems.map((item) => {
    const from = item.from - minFrom
    const availableDuration = Math.max(1, durationInFrames - from)
    return {
      ...item,
      from,
      durationInFrames:
        singleVisualItem && item.type !== 'audio'
          ? availableDuration
          : Math.min(item.durationInFrames, availableDuration),
      trackId: trackIdMapping.get(item.trackId) ?? item.trackId,
    }
  })
  const childItemIds = new Set(childItems.map((item) => item.id))
  const childTransitions = parent.transitions
    .filter(
      (transition) =>
        childItemIds.has(transition.leftClipId) && childItemIds.has(transition.rightClipId),
    )
    .map((transition) => ({
      ...transition,
      trackId: trackIdMapping.get(transition.trackId) ?? transition.trackId,
    }))
  const childKeyframes = parent.keyframes.filter((entry) => childItemIds.has(entry.itemId))
  const compositionId = crypto.randomUUID()
  const label =
    sourceVisualItems.length === 1
      ? sourceVisualItems[0]!.label
      : sourceVisualItems.map((item) => item.label).join(' → ')
  const composition: SubComposition = {
    id: compositionId,
    name: label,
    items: childItems,
    tracks: childTracks,
    transitions: childTransitions,
    keyframes: childKeyframes,
    fps: parent.fps,
    width: parent.width,
    height: parent.height,
    durationInFrames,
    markers: [],
    inPoint: null,
    outPoint: null,
  }
  const wrapper: CompositionItem = {
    id: crypto.randomUUID(),
    type: 'composition',
    trackId: slotTrack.id,
    from: 0,
    durationInFrames,
    label,
    compositionId,
    compositionWidth: parent.width,
    compositionHeight: parent.height,
    compositionFit: 'cover',
    sourceStart: 0,
    sourceEnd: durationInFrames,
    sourceDuration: durationInFrames,
    sourceFps: parent.fps,
    speed: 1,
    transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
  }

  return { composition, wrapper }
}

interface BuiltSlot {
  composition: SubComposition
  wrapper: CompositionItem
}

interface ReusableSlotSource {
  composition: SubComposition
  binding: {
    id: string
    compositionId: string
    label: string
  }
}

function cloneTimelineSourceAsSlot(params: {
  sourceItem: TimelineItem
  parent: SubComposition
  minimumDurationInFrames: number
}): ReusableSlotSource | null {
  const { sourceItem, parent, minimumDurationInFrames } = params
  if (sourceItem.type === 'audio') return null

  const timelineItems = useItemsStore.getState().items
  const timelineTracks = useItemsStore.getState().tracks
  const linkedAudio = getLinkedAudioCompanion(timelineItems, sourceItem)
  const sourceItems = [sourceItem, ...(linkedAudio ? [linkedAudio] : [])]
  const minFrom = Math.min(...sourceItems.map((item) => item.from))
  const maxEnd = Math.max(...sourceItems.map((item) => item.from + item.durationInFrames))
  const sourceTrackById = new Map(timelineTracks.map((track) => [track.id, track]))
  const sourceTrackIds = [...new Set(sourceItems.map((item) => item.trackId))]
  const trackIdMapping = new Map<string, string>()
  const tracks = sourceTrackIds.map((trackId, index) => {
    const id = crypto.randomUUID()
    trackIdMapping.set(trackId, id)
    const sourceTrack = sourceTrackById.get(trackId)
    return {
      ...(sourceTrack ?? {
        name: `Track ${index + 1}`,
        kind: index === 0 ? 'video' : 'audio',
        height: DEFAULT_TRACK_HEIGHT,
        locked: false,
        syncLock: true,
        visible: true,
        muted: false,
        solo: false,
        volume: 0,
        order: index,
        items: [],
      }),
      id,
      order: index,
      items: [],
    } satisfies TimelineTrack
  })
  const itemIdMapping = new Map<string, string>()
  const linkedGroupId = linkedAudio ? crypto.randomUUID() : undefined
  const items = sourceItems.map((item) => {
    const id = crypto.randomUUID()
    itemIdMapping.set(item.id, id)
    return {
      ...item,
      id,
      from: item.from - minFrom,
      trackId: trackIdMapping.get(item.trackId) ?? tracks[0]!.id,
      ...(item.linkedGroupId && linkedGroupId ? { linkedGroupId } : {}),
    }
  })
  const sourceItemIds = new Set(sourceItems.map((item) => item.id))
  const keyframes = useKeyframesStore
    .getState()
    .keyframes.filter((entry) => sourceItemIds.has(entry.itemId))
    .map((entry) => ({ ...entry, itemId: itemIdMapping.get(entry.itemId) ?? entry.itemId }))
  const compositionId = crypto.randomUUID()
  const composition: SubComposition = {
    id: compositionId,
    name: sourceItem.label,
    items,
    tracks,
    transitions: [],
    keyframes,
    fps: parent.fps,
    width: parent.width,
    height: parent.height,
    durationInFrames: Math.max(minimumDurationInFrames, maxEnd - minFrom),
    markers: [],
    inPoint: null,
    outPoint: null,
  }
  return {
    composition,
    binding: {
      id: crypto.randomUUID(),
      compositionId,
      label: sourceItem.label,
    },
  }
}

interface GeneratedVisualLayer {
  items: TimelineItem[]
  tracks: TimelineTrack[]
  keyframes: ItemKeyframes[]
}

function attachMotionDepthEffects(layer: GeneratedVisualLayer): GeneratedVisualLayer {
  const keyframesByItemId = new Map(layer.keyframes.map((entry) => [entry.itemId, entry]))
  return {
    ...layer,
    items: layer.items.map((item) => {
      const effectProperty = motionLayoutDepthProperty(item.id)
      const hasDepthAnimation = keyframesByItemId
        .get(item.id)
        ?.properties.some((property) => property.property === effectProperty)
      if (!hasDepthAnimation) return item

      const effectId = motionLayoutDepthEffectId(item.id)
      const depthEffect: ItemEffect = {
        id: effectId,
        enabled: true,
        effect: {
          type: 'gpu-effect',
          gpuEffectType: 'gpu-brightness',
          params: { amount: 0 },
        },
      }
      return {
        ...item,
        effects: [...(item.effects ?? []).filter((effect) => effect.id !== effectId), depthEffect],
      }
    }),
  }
}

function buildEditableSlot(params: {
  parent: SubComposition
  composition: SubComposition
  bindingId: string
  label: string
  slotTrack: TimelineTrack
  durationInFrames: number
}): BuiltSlot {
  const { parent, composition, bindingId, label, slotTrack, durationInFrames } = params
  return {
    composition,
    wrapper: {
      id: bindingId,
      type: 'composition',
      trackId: slotTrack.id,
      from: 0,
      durationInFrames,
      label,
      compositionId: composition.id,
      compositionWidth: composition.width,
      compositionHeight: composition.height,
      compositionFit: 'cover',
      sourceStart: 0,
      sourceEnd: durationInFrames,
      sourceDuration: durationInFrames,
      sourceFps: parent.fps,
      speed: 1,
      transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
    },
  }
}

function remapItemKeyframes(
  source: ItemKeyframes,
  itemId: string,
  durationInFrames: number,
  frameOffset = 0,
  shiftPosition?: { axis: 'x' | 'y'; amount: number },
): ItemKeyframes {
  const opacityByFrame = new Map(
    source.properties
      .find((property) => property.property === 'opacity')
      ?.keyframes.map((keyframe) => [keyframe.frame, keyframe.value]) ?? [],
  )
  return {
    itemId,
    properties: source.properties.map((property) => {
      const byFrame = new Map<number, (typeof property.keyframes)[number]>()
      for (const keyframe of property.keyframes) {
        const shiftedFrame =
          keyframe.frame === 0 || keyframe.frame === durationInFrames - 1
            ? keyframe.frame
            : Math.min(durationInFrames - 1, keyframe.frame + frameOffset)
        const hidden = (opacityByFrame.get(keyframe.frame) ?? 1) < 0.5
        const positionShift =
          shiftPosition && property.property === shiftPosition.axis && hidden
            ? shiftPosition.amount
            : 0
        byFrame.set(shiftedFrame, {
          ...keyframe,
          id: `motion-layout:${itemId}:${property.property}:${shiftedFrame}`,
          frame: shiftedFrame,
          value: keyframe.value + positionShift,
        })
      }
      return {
        ...property,
        keyframes: [...byFrame.values()].sort((left, right) => left.frame - right.frame),
      }
    }),
  }
}

function buildStripeActors(params: {
  builtSlots: BuiltSlot[]
  planKeyframes: ItemKeyframes[]
  durationInFrames: number
  settings: MotionLayoutSettings
  fps: number
}): GeneratedVisualLayer {
  const strips = Math.max(2, Math.min(16, Math.round(params.settings.strips)))
  const items: TimelineItem[] = []
  const tracks: TimelineTrack[] = []
  const keyframes: ItemKeyframes[] = []
  const sourceKeyframesById = new Map(params.planKeyframes.map((entry) => [entry.itemId, entry]))

  params.builtSlots.forEach((slot) => {
    const sourceKeyframes = sourceKeyframesById.get(slot.wrapper.id)
    if (!sourceKeyframes) return
    for (let stripIndex = 0; stripIndex < strips; stripIndex += 1) {
      const itemId = stripIndex === 0 ? slot.wrapper.id : crypto.randomUUID()
      const track = createSlotTrack(tracks.length)
      tracks.push(track)
      items.push({
        ...slot.wrapper,
        id: itemId,
        trackId: track.id,
        crop: {
          left: stripIndex / strips,
          right: 1 - (stripIndex + 1) / strips,
        },
      })
      keyframes.push(
        remapItemKeyframes(
          sourceKeyframes,
          itemId,
          params.durationInFrames,
          Math.round(stripIndex * params.fps * 0.025),
        ),
      )
    }
  })

  return { items, tracks, keyframes }
}

function buildSplitActors(params: {
  builtSlots: BuiltSlot[]
  planKeyframes: ItemKeyframes[]
  durationInFrames: number
  settings: MotionLayoutSettings
  width: number
  height: number
}): GeneratedVisualLayer {
  const items: TimelineItem[] = []
  const tracks: TimelineTrack[] = []
  const keyframes: ItemKeyframes[] = []
  const sourceKeyframesById = new Map(params.planKeyframes.map((entry) => [entry.itemId, entry]))
  const horizontal = params.settings.direction === 'horizontal'

  params.builtSlots.forEach((slot) => {
    const sourceKeyframes = sourceKeyframesById.get(slot.wrapper.id)
    if (!sourceKeyframes) return
    for (let half = 0; half < 2; half += 1) {
      const itemId = half === 0 ? slot.wrapper.id : crypto.randomUUID()
      const track = createSlotTrack(tracks.length)
      tracks.push(track)
      items.push({
        ...slot.wrapper,
        id: itemId,
        trackId: track.id,
        crop: horizontal
          ? { left: half === 0 ? 0 : 0.5, right: half === 0 ? 0.5 : 0 }
          : { top: half === 0 ? 0 : 0.5, bottom: half === 0 ? 0.5 : 0 },
      })
      keyframes.push(
        remapItemKeyframes(sourceKeyframes, itemId, params.durationInFrames, 0, {
          axis: horizontal ? 'x' : 'y',
          amount: (half === 0 ? -1 : 1) * (horizontal ? params.width : params.height) * 0.22,
        }),
      )
    }
  })

  return { items, tracks, keyframes }
}

function buildDiagonalMask(params: {
  builtSlots: BuiltSlot[]
  slotTracks: TimelineTrack[]
  planKeyframes: ItemKeyframes[]
  durationInFrames: number
  settings: MotionLayoutSettings
  width: number
  height: number
}): GeneratedVisualLayer {
  const maskTrack = createSlotTrack(0)
  maskTrack.name = 'Reveal mask'
  const visualTracks = params.slotTracks.map((track, index) => ({ ...track, order: index + 1 }))
  const maskId = crypto.randomUUID()
  const mask: ShapeItem = {
    id: maskId,
    type: 'shape',
    trackId: maskTrack.id,
    from: 0,
    durationInFrames: params.durationInFrames,
    label: 'Reveal mask',
    shapeType: 'rectangle',
    fillColor: '#ffffff',
    strokeWidth: 0,
    isMask: true,
    maskType: 'clip',
    maskFeather: 0,
    transform: {
      x: -params.width * 1.15,
      y: 0,
      width: params.width * 1.6,
      height: params.height * 2.4,
      rotation: params.settings.edgeAngle,
      opacity: 1,
    },
  }
  const keyframes = [] as ItemKeyframes['properties'][number]['keyframes']
  const phaseCount = params.builtSlots.length
  const segmentFrames = (params.durationInFrames - 1) / phaseCount
  for (let phase = 0; phase < phaseCount; phase += 1) {
    const start = Math.round(phase * segmentFrames)
    const revealEnd = Math.min(
      params.durationInFrames - 1,
      Math.round(start + segmentFrames * 0.28),
    )
    const holdEnd = Math.min(
      params.durationInFrames - 1,
      Math.round(start + segmentFrames * Math.max(0.35, params.settings.hold)),
    )
    keyframes.push(
      {
        id: `motion-layout:${maskId}:x:${start}`,
        frame: start,
        value: -params.width * 1.15,
        easing: 'ease-in-out',
      },
      {
        id: `motion-layout:${maskId}:x:${revealEnd}`,
        frame: revealEnd,
        value: 0,
        easing: 'hold',
      },
      {
        id: `motion-layout:${maskId}:x:${holdEnd}`,
        frame: holdEnd,
        value: 0,
        easing: 'hold',
      },
    )
  }

  return {
    items: [mask, ...params.builtSlots.map((slot) => slot.wrapper)],
    tracks: [maskTrack, ...visualTracks],
    keyframes: [
      ...params.planKeyframes,
      {
        itemId: maskId,
        properties: [
          {
            property: 'x',
            keyframes: keyframes
              .toSorted((left, right) => left.frame - right.frame)
              .filter((keyframe, index, sorted) => sorted[index - 1]?.frame !== keyframe.frame),
          },
        ],
      },
    ],
  }
}

function buildGeneratedVisualLayer(params: {
  templateId: MotionLayoutTemplateId
  builtSlots: BuiltSlot[]
  slotTracks: TimelineTrack[]
  planKeyframes: ItemKeyframes[]
  durationInFrames: number
  settings: MotionLayoutSettings
  fps: number
  width: number
  height: number
}): GeneratedVisualLayer {
  if (params.templateId === 'stripe-reveal') return buildStripeActors(params)
  if (params.templateId === 'split-reveal') return buildSplitActors(params)
  if (params.templateId === 'diagonal-wipe') return buildDiagonalMask(params)
  if (
    params.templateId === 'showcase-stream' ||
    params.templateId === 'card-totem' ||
    params.templateId === 'film-strip' ||
    params.templateId === 'orbit-carousel'
  ) {
    const inset = params.width * params.settings.perspective * 0.22
    return {
      items: params.builtSlots.map((slot, index) => {
        const slant =
          (index % 2 === 0 ? -1 : 1) * params.height * params.settings.perspective * 0.16
        return {
          ...slot.wrapper,
          cornerPin: {
            topLeft: [inset, slant],
            topRight: [-inset, -slant],
            bottomRight: [-inset * 0.2, slant * 0.4],
            bottomLeft: [inset * 0.2, -slant * 0.4],
            referenceWidth: params.width,
            referenceHeight: params.height,
          },
        }
      }),
      tracks: params.slotTracks,
      keyframes: params.planKeyframes,
    }
  }
  return {
    items: params.builtSlots.map((slot) => slot.wrapper),
    tracks: params.slotTracks,
    keyframes: params.planKeyframes,
  }
}

/**
 * Convert the selected timeline items into a template-bound compound clip.
 * Source animation remains inside one child composition per slot; generated
 * template keyframes target only the slot wrappers in the parent composition.
 */
export function applyMotionLayout(input: ApplyMotionLayoutInput): CompositionItem | null {
  return execute(
    'APPLY_MOTION_LAYOUT',
    () => {
      const beforeItems = useItemsStore.getState().items
      const requestedIds = new Set(input.itemIds)
      const beforeVisualItems = beforeItems.filter(
        (item) => requestedIds.has(item.id) && item.type !== 'audio',
      )
      if (beforeVisualItems.length < 2) return null
      const template = MOTION_LAYOUT_TEMPLATE_BY_ID[input.templateId]
      if (input.chainOrder.filter((chain) => chain.length > 0).length < template.minSlots) {
        return null
      }

      const preCompItemIds = new Set(input.itemIds)
      for (const visualItem of beforeVisualItems) {
        const linkedAudio = getLinkedAudioCompanion(beforeItems, visualItem)
        if (linkedAudio) preCompItemIds.add(linkedAudio.id)
      }

      const created = createPreCompMutation(input.name, [...preCompItemIds])
      if (!created || created.type !== 'composition') return null

      const parent = useCompositionsStore.getState().getComposition(created.compositionId)
      if (!parent) return null
      const frameWidth = Math.max(2, Math.round(input.frameWidth ?? parent.width))
      const frameHeight = Math.max(2, Math.round(input.frameHeight ?? parent.height))

      const orderedChains = buildOrderedChains(parent, beforeVisualItems, input.chainOrder)
      const usableChains = orderedChains.slice(0, template.maxSlots)
      if (usableChains.length < template.minSlots) return null

      const durationInFrames = Math.max(2, Math.round(input.settings.durationSeconds * parent.fps))
      const slotTracks = usableChains.map((_, index) => createSlotTrack(index))
      const builtSlots = usableChains.flatMap((chain, index) => {
        const built = buildSlotComposition({
          parent,
          chain,
          slotTrack: slotTracks[index]!,
          durationInFrames,
        })
        return built ? [built] : []
      })
      if (builtSlots.length < template.minSlots) return null

      const plan = buildMotionLayoutPlan({
        templateId: input.templateId,
        slotIds: builtSlots.map((slot) => slot.wrapper.id),
        width: frameWidth,
        height: frameHeight,
        fps: parent.fps,
        settings: input.settings,
      })
      const generatedVisual = attachMotionDepthEffects(
        buildGeneratedVisualLayer({
          templateId: input.templateId,
          builtSlots,
          slotTracks: slotTracks.slice(0, builtSlots.length),
          planKeyframes: plan.slots.map((slot) => slot.keyframes),
          durationInFrames,
          settings: input.settings,
          fps: parent.fps,
          width: frameWidth,
          height: frameHeight,
        }),
      )

      const slottedAudioItemIds = new Set(
        builtSlots.flatMap((slot) =>
          slot.composition.items.flatMap((item) => (item.type === 'audio' ? [item.id] : [])),
        ),
      )
      const audioItems = parent.items.flatMap((item) => {
        if (item.type !== 'audio' || slottedAudioItemIds.has(item.id)) return []
        const clipped = clipItemToDuration(item, durationInFrames)
        return clipped ? [clipped] : []
      })
      const audioItemIds = new Set(audioItems.map((item) => item.id))
      const audioTrackIds = new Set(audioItems.map((item) => item.trackId))
      const audioTracks = parent.tracks
        .filter((track) => audioTrackIds.has(track.id))
        .map((track, index) => ({
          ...track,
          order: generatedVisual.tracks.length + index,
          items: [],
        }))
      const nextParent: SubComposition = {
        ...parent,
        name: input.name,
        items: [...audioItems, ...generatedVisual.items],
        tracks: [...generatedVisual.tracks, ...audioTracks],
        transitions: [],
        keyframes: [
          ...parent.keyframes.filter((entry) => audioItemIds.has(entry.itemId)),
          ...generatedVisual.keyframes,
        ],
        durationInFrames,
        width: frameWidth,
        height: frameHeight,
        backgroundColor: input.settings.backgroundColor,
        motionLayout: {
          templateId: input.templateId,
          templateVersion: template.version,
          ...(input.frameAspect ? { frameAspect: input.frameAspect } : {}),
          settings: { ...input.settings },
          slotOrder: builtSlots.map((slot) => slot.composition.id),
          slots: builtSlots.map((slot) => ({
            id: slot.wrapper.id,
            compositionId: slot.composition.id,
            label: slot.wrapper.label,
          })),
        },
      }

      const compositions = useCompositionsStore.getState().compositions
      useCompositionsStore
        .getState()
        .setCompositions([
          ...compositions.map((composition) =>
            composition.id === nextParent.id ? nextParent : composition,
          ),
          ...builtSlots.map((slot) => slot.composition),
        ])

      for (const item of useItemsStore.getState().items) {
        if (item.compositionId !== nextParent.id) continue
        useItemsStore.getState()._updateItem(item.id, {
          label: input.name,
          durationInFrames,
          sourceStart: 0,
          sourceEnd: durationInFrames,
          sourceDuration: durationInFrames,
          sourceFps: nextParent.fps,
          compositionWidth: frameWidth,
          compositionHeight: frameHeight,
          speed: 1,
        })
      }

      useTimelineSettingsStore.getState().markDirty()
      const refreshed = useItemsStore.getState().itemById[created.id]
      return refreshed?.type === 'composition' ? refreshed : created
    },
    {
      count: input.itemIds.length,
      templateId: input.templateId,
    },
  )
}

/**
 * Recompile an existing Motion Layout without consuming its source clips again.
 * Slot compositions are reused verbatim, so edits made inside a slot survive
 * template, ordering, and parameter changes.
 */
export function updateMotionLayout(input: UpdateMotionLayoutInput): CompositionItem | null {
  return execute(
    'UPDATE_MOTION_LAYOUT',
    () => {
      const compositionsState = useCompositionsStore.getState()
      const parent = compositionsState.getComposition(input.compositionId)
      if (!parent?.motionLayout) return null
      const frameWidth = Math.max(2, Math.round(input.frameWidth ?? parent.width))
      const frameHeight = Math.max(2, Math.round(input.frameHeight ?? parent.height))

      const template = MOTION_LAYOUT_TEMPLATE_BY_ID[input.templateId]
      const allBindings = [...parent.motionLayout.slots]
      const bindingsByCompositionId = new Map(
        allBindings.map((binding) => [binding.compositionId, binding]),
      )
      const newCompositionsById = new Map<string, SubComposition>()
      const timelineItemById = useItemsStore.getState().itemById
      const requestedSourceIds = [...new Set(input.slotCompositionIds)]
      const orderedCompositionIds = requestedSourceIds.flatMap((sourceId) => {
        if (
          bindingsByCompositionId.has(sourceId) &&
          Boolean(compositionsState.getComposition(sourceId))
        ) {
          return [sourceId]
        }

        const sourceItem = timelineItemById[sourceId]
        if (!sourceItem || sourceItem.type === 'audio' || sourceItem.compositionId === parent.id) {
          return []
        }
        const cloned = cloneTimelineSourceAsSlot({
          sourceItem,
          parent,
          minimumDurationInFrames: Math.max(
            2,
            Math.round(input.settings.durationSeconds * parent.fps),
          ),
        })
        if (!cloned) return []
        allBindings.push(cloned.binding)
        bindingsByCompositionId.set(cloned.composition.id, cloned.binding)
        newCompositionsById.set(cloned.composition.id, cloned.composition)
        return [cloned.composition.id]
      })
      const visibleCompositionIds = orderedCompositionIds.slice(0, template.maxSlots)
      if (visibleCompositionIds.length < template.minSlots) return null

      const durationInFrames = Math.max(2, Math.round(input.settings.durationSeconds * parent.fps))
      const slotTracks = visibleCompositionIds.map((_, index) => createSlotTrack(index))
      const builtSlots = visibleCompositionIds.flatMap((compositionId, index) => {
        const binding = bindingsByCompositionId.get(compositionId)
        const composition =
          newCompositionsById.get(compositionId) ?? compositionsState.getComposition(compositionId)
        const slotTrack = slotTracks[index]
        if (!binding || !composition || !slotTrack) return []
        return [
          buildEditableSlot({
            parent,
            composition,
            bindingId: binding.id,
            label: binding.label || composition.name,
            slotTrack,
            durationInFrames,
          }),
        ]
      })
      if (builtSlots.length < template.minSlots) return null

      const plan = buildMotionLayoutPlan({
        templateId: input.templateId,
        slotIds: builtSlots.map((slot) => slot.wrapper.id),
        width: frameWidth,
        height: frameHeight,
        fps: parent.fps,
        settings: input.settings,
      })
      const generatedVisual = attachMotionDepthEffects(
        buildGeneratedVisualLayer({
          templateId: input.templateId,
          builtSlots,
          slotTracks: slotTracks.slice(0, builtSlots.length),
          planKeyframes: plan.slots.map((slot) => slot.keyframes),
          durationInFrames,
          settings: input.settings,
          fps: parent.fps,
          width: frameWidth,
          height: frameHeight,
        }),
      )

      const audioItems = parent.items.flatMap((item) => {
        if (item.type !== 'audio') return []
        const clipped = clipItemToDuration(item, durationInFrames)
        return clipped ? [clipped] : []
      })
      const audioItemIds = new Set(audioItems.map((item) => item.id))
      const audioTrackIds = new Set(audioItems.map((item) => item.trackId))
      const audioTracks = parent.tracks
        .filter((track) => audioTrackIds.has(track.id))
        .map((track, index) => ({
          ...track,
          order: generatedVisual.tracks.length + index,
          items: [],
        }))
      const nextParent: SubComposition = {
        ...parent,
        name: input.name,
        items: [...audioItems, ...generatedVisual.items],
        tracks: [...generatedVisual.tracks, ...audioTracks],
        transitions: [],
        keyframes: [
          ...parent.keyframes.filter((entry) => audioItemIds.has(entry.itemId)),
          ...generatedVisual.keyframes,
        ],
        durationInFrames,
        width: frameWidth,
        height: frameHeight,
        backgroundColor: input.settings.backgroundColor,
        motionLayout: {
          templateId: input.templateId,
          templateVersion: template.version,
          ...(input.frameAspect ? { frameAspect: input.frameAspect } : {}),
          settings: { ...input.settings },
          slotOrder: orderedCompositionIds,
          slots: allBindings,
        },
      }

      compositionsState.setCompositions([
        ...compositionsState.compositions.map((composition) =>
          composition.id === nextParent.id ? nextParent : composition,
        ),
        ...newCompositionsById.values(),
      ])
      for (const item of useItemsStore.getState().items) {
        if (item.compositionId !== nextParent.id) continue
        useItemsStore.getState()._updateItem(item.id, {
          label: input.name,
          durationInFrames,
          sourceStart: 0,
          sourceEnd: durationInFrames,
          sourceDuration: durationInFrames,
          sourceFps: nextParent.fps,
          compositionWidth: frameWidth,
          compositionHeight: frameHeight,
          speed: 1,
        })
      }

      useTimelineSettingsStore.getState().markDirty()
      return (
        useItemsStore
          .getState()
          .items.find(
            (item): item is CompositionItem =>
              item.type === 'composition' && item.compositionId === nextParent.id,
          ) ?? null
      )
    },
    {
      compositionId: input.compositionId,
      templateId: input.templateId,
    },
  )
}
