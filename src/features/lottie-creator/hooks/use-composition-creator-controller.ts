/**
 * Binds a `kind:'lottie'` SubComposition to the shared `CreatorController`
 * contract, so the in-editor "enter-to-edit" surface reuses the exact same rich
 * authoring UI as the standalone `/lottie` route.
 *
 * While drilled into a lottie composition, `loadComposition` has already loaded
 * `comp.items`/`comp.tracks` into `useItemsStore` and `comp.keyframes` into
 * `useKeyframesStore` — those live domain stores ARE the composition's content,
 * so every layer/keyframe mutation here goes through the same undo-wrapped
 * timeline actions the real dopesheet uses. Only comp-level metadata
 * (width/height/fps/name) still writes through `updateComposition`. Transient
 * view state: selection lives in the shared selection store, the playhead is
 * the shared playback store's `currentFrame` (so it stays in sync with the
 * timeline dopesheet), and `isPlaying` stays local React state — none of it
 * touches the persisted composition.
 *
 * Model: each layer is one full-duration item (`from: 0`,
 * `durationInFrames: comp.durationInFrames`) on its own track. Track `order`
 * doubles as z-order — lower `order` renders on top — so layers are read back
 * out sorted ascending by their track's order (top-first).
 */
import { useMemo, useState } from 'react'
import type { TextItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import type { CreatorItem, CreatorLayer } from '@/types/lottie-creation'
import { useSelectionStore } from '@/shared/state/selection'
import { usePlaybackStore } from '@/shared/state/playback'
import { createShapeLayerItem, buildPresetKeyframes } from '../utils/presets'
import type { CreatorController } from '../components/lottie-creator-surface'
import {
  useCompositionsStore,
  useItemsStore,
  useKeyframesStore,
  useTimelineCommandStore,
  useTimelineSettingsStore,
  addItemOnNewTrack,
  setTracks,
  updateItem,
  removeItems,
  addKeyframes,
  removeKeyframesForItem,
  removeKeyframesForProperty,
  captureSnapshot,
  DEFAULT_TRACK_HEIGHT,
} from '../deps/timeline'
import type { SubComposition } from '../deps/timeline'
import {
  buildLayerTree,
  groupTracksIntoFolder,
  ungroupFolder as ungroupFolderTracks,
} from '../utils/folder-tree'
import { moveTrackInTree } from '../utils/reorder-tree'
import { useCreatorClipboardStore, type ClipboardLayer } from '../stores/creator-clipboard'

/** Only shape/text items are valid Lottie-creator layers. */
function isCreatorItem(item: TimelineItem): item is CreatorItem {
  return item.type === 'shape' || item.type === 'text'
}

/** A fresh full-height track placed above every existing track (lowest order = topmost). */
function newLayerTrack(existingTracks: TimelineTrack[], name: string): TimelineTrack {
  const minOrder = existingTracks.length > 0 ? Math.min(...existingTracks.map((t) => t.order)) : 0
  return {
    id: crypto.randomUUID(),
    name,
    kind: 'video',
    height: DEFAULT_TRACK_HEIGHT,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: minOrder - 1,
    items: [],
  }
}

export function useCompositionCreatorController(comp: SubComposition): CreatorController {
  const [isPlaying, setIsPlaying] = useState(false)

  const items = useItemsStore((s) => s.items)
  const tracks = useItemsStore((s) => s.tracks)
  const keyframesByItemId = useKeyframesStore((s) => s.keyframesByItemId)
  const selectedIds = useSelectionStore((s) => s.selectedItemIds)
  const selectedId = selectedIds[0] ?? null
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const canUndo = useTimelineCommandStore((s) => s.canUndo)
  const canRedo = useTimelineCommandStore((s) => s.canRedo)

  // Derive layers (top-first) from the live items/tracks/keyframes stores.
  const layers = useMemo<CreatorLayer[]>(() => {
    const orderByTrackId = new Map(tracks.map((t) => [t.id, t.order]))
    return items
      .filter(isCreatorItem)
      .slice()
      .sort((a, b) => (orderByTrackId.get(a.trackId) ?? 0) - (orderByTrackId.get(b.trackId) ?? 0))
      .map((item) => ({
        item,
        properties: keyframesByItemId[item.id]?.properties ?? [],
      }))
  }, [items, tracks, keyframesByItemId])

  // Nested layer/folder tree (folders = `isGroup` tracks, nesting via
  // `parentTrackId`) for the outliner + timeline. All layers stay in this comp's
  // live stores, so grouping is purely a track-tree reshape (one `setTracks`
  // undo step) and every edit action keeps working unchanged.
  const layerTree = useMemo(() => buildLayerTree(items, tracks), [items, tracks])

  return useMemo<CreatorController>(() => {
    const updateMeta = (updates: Partial<Omit<SubComposition, 'id'>>) =>
      useCompositionsStore.getState().updateComposition(comp.id, updates)

    const clampPlayhead = (duration: number) =>
      usePlaybackStore
        .getState()
        .setCurrentFrame(Math.min(usePlaybackStore.getState().currentFrame, duration - 1))

    // Snapshot the given layers (item + keyframes) for the clipboard / duplicate.
    const snapshotLayers = (layerIds: string[]): ClipboardLayer[] => {
      const state = useItemsStore.getState()
      const keyframes = useKeyframesStore.getState().keyframesByItemId
      return layerIds.flatMap((id) => {
        const item = state.items.find((it) => it.id === id)
        if (!item || !isCreatorItem(item)) return []
        return [
          {
            item: structuredClone(item),
            properties: structuredClone(keyframes[id]?.properties ?? []),
          },
        ]
      })
    }

    // Re-instantiate clipboard layers as fresh top-of-stack layers (new ids +
    // tracks + keyframes), offset slightly so a paste is visible. Bracketed into
    // a single undo step via captureSnapshot + addUndoEntry, using the raw
    // (non-undo) store setters in between.
    const instantiateLayers = (clipLayers: ClipboardLayer[]) => {
      if (clipLayers.length === 0) return
      const state = useItemsStore.getState()
      let order = state.tracks.length > 0 ? Math.min(...state.tracks.map((t) => t.order)) : 0

      const newTracks: TimelineTrack[] = []
      const newItems: TimelineItem[] = []
      const keyframePayloads: Array<{
        itemId: string
        property: (typeof clipLayers)[number]['properties'][number]['property']
        frame: number
        value: number
        easing: (typeof clipLayers)[number]['properties'][number]['keyframes'][number]['easing']
        easingConfig?: (typeof clipLayers)[number]['properties'][number]['keyframes'][number]['easingConfig']
      }> = []
      const newIds: string[] = []

      for (const clip of clipLayers) {
        const trackId = crypto.randomUUID()
        order -= 1
        newTracks.push({
          id: trackId,
          name: clip.item.label,
          kind: 'video',
          height: DEFAULT_TRACK_HEIGHT,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order,
          items: [],
        })
        const newItemId = crypto.randomUUID()
        const base = structuredClone(clip.item)
        const transform = base.transform ?? {}
        newItems.push({
          ...base,
          id: newItemId,
          trackId,
          from: 0,
          durationInFrames: comp.durationInFrames,
          transform: { ...transform, x: (transform.x ?? 0) + 16, y: (transform.y ?? 0) + 16 },
        } as TimelineItem)
        newIds.push(newItemId)
        for (const prop of clip.properties) {
          for (const keyframe of prop.keyframes) {
            keyframePayloads.push({
              itemId: newItemId,
              property: prop.property,
              frame: keyframe.frame,
              value: keyframe.value,
              easing: keyframe.easing,
              easingConfig: keyframe.easingConfig,
            })
          }
        }
      }

      const before = captureSnapshot()
      useItemsStore.getState().setTracks([...state.tracks, ...newTracks])
      useItemsStore.getState()._addItems(newItems)
      if (keyframePayloads.length > 0) useKeyframesStore.getState()._addKeyframes(keyframePayloads)
      useTimelineCommandStore
        .getState()
        .addUndoEntry({ type: 'PASTE_LOTTIE_LAYERS', payload: {} }, before)
      useTimelineSettingsStore.getState().markDirty()
      useSelectionStore.getState().selectItems(newIds)
    }

    return {
      width: comp.width,
      height: comp.height,
      fps: comp.fps,
      durationInFrames: comp.durationInFrames,
      layers,
      layerTree,
      selectedId,
      selectedIds,
      playhead: currentFrame,
      isPlaying,
      name: comp.name,

      addShape: (shapeType) => {
        const state = useItemsStore.getState()
        const item = createShapeLayerItem(shapeType, {
          index: state.items.filter(isCreatorItem).length,
          width: comp.width,
          height: comp.height,
          durationInFrames: comp.durationInFrames,
        })
        const track = newLayerTrack(state.tracks, item.label)
        const placed = { ...item, trackId: track.id }
        addItemOnNewTrack(placed, [...state.tracks, track])
        useSelectionStore.getState().selectItems([placed.id])
      },

      addText: () => {
        const state = useItemsStore.getState()
        const track = newLayerTrack(state.tracks, 'Text')
        const item: TextItem = {
          id: crypto.randomUUID(),
          trackId: track.id,
          from: 0,
          durationInFrames: comp.durationInFrames,
          label: 'Text',
          type: 'text',
          text: 'Text',
          color: '#ffffff',
          fontSize: 72,
          transform: { x: 0, y: 0, width: Math.round(comp.width * 0.6), height: 100 },
        }
        addItemOnNewTrack(item, [...state.tracks, track])
        useSelectionStore.getState().selectItems([item.id])
      },

      loadTemplate: (doc) => {
        // Replace every existing layer with the template's (removeItems cascades
        // to keyframes), then re-lay each template layer on its own new track,
        // preserving the template's top-first order.
        const state = useItemsStore.getState()
        const existingIds = state.items.filter(isCreatorItem).map((it) => it.id)
        if (existingIds.length > 0) removeItems(existingIds)

        const baseTracks = useItemsStore.getState().tracks
        const minOrder = baseTracks.length > 0 ? Math.min(...baseTracks.map((t) => t.order)) : 0
        const layerCount = doc.layers.length
        const newTracks: TimelineTrack[] = doc.layers.map((l, i) => ({
          id: crypto.randomUUID(),
          name: l.item.label,
          kind: 'video',
          height: DEFAULT_TRACK_HEIGHT,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          // doc.layers is top-first; ascending order = top-first, so the first
          // layer gets the smallest (most negative) order.
          order: minOrder - layerCount + i,
          items: [],
        }))
        const newItems = doc.layers.map((l, i) => ({
          ...l.item,
          trackId: newTracks[i]!.id,
          from: 0,
          durationInFrames: doc.durationInFrames,
        }))
        const finalTracks = [...baseTracks, ...newTracks]
        for (const item of newItems) addItemOnNewTrack(item, finalTracks)

        const payloads = doc.layers.flatMap((l, i) =>
          l.properties.flatMap((p) =>
            p.keyframes.map((k) => ({
              itemId: newItems[i]!.id,
              property: p.property,
              frame: k.frame,
              value: k.value,
              easing: k.easing,
              easingConfig: k.easingConfig,
            })),
          ),
        )
        if (payloads.length > 0) addKeyframes(payloads)

        updateMeta({
          width: doc.width,
          height: doc.height,
          durationInFrames: doc.durationInFrames,
        })
        useSelectionStore.getState().selectItems(newItems[0] ? [newItems[0].id] : [])
        usePlaybackStore.getState().setCurrentFrame(0)
        setIsPlaying(true)
      },

      removeLayer: (id) => {
        removeItems([id])
        if (selectedId === id) {
          useSelectionStore.getState().clearSelection()
        }
      },

      groupLayers: (layerIds) => {
        const state = useItemsStore.getState()
        const memberTrackIds = layerIds
          .map((id) => state.items.find((it) => it.id === id)?.trackId)
          .filter((trackId): trackId is string => trackId !== undefined)
        if (memberTrackIds.length === 0) return
        setTracks(groupTracksIntoFolder(state.tracks, memberTrackIds, crypto.randomUUID(), 'Group'))
      },

      ungroupFolder: (folderTrackId) =>
        setTracks(ungroupFolderTracks(useItemsStore.getState().tracks, folderTrackId)),

      moveTrack: (sourceTrackId, target) =>
        setTracks(moveTrackInTree(useItemsStore.getState().tracks, sourceTrackId, target)),

      copyLayers: (layerIds) => {
        const layers = snapshotLayers(layerIds)
        if (layers.length > 0) useCreatorClipboardStore.getState().setLayers(layers)
      },

      pasteLayers: () => instantiateLayers(useCreatorClipboardStore.getState().layers),

      duplicateLayers: (layerIds) => instantiateLayers(snapshotLayers(layerIds)),

      removeLayers: (layerIds) => {
        if (layerIds.length === 0) return
        removeItems(layerIds)
        useSelectionStore.getState().clearSelection()
      },

      ungroupSelection: () => {
        const state = useItemsStore.getState()
        const firstId = useSelectionStore.getState().selectedItemIds[0]
        const trackId = state.items.find((it) => it.id === firstId)?.trackId
        const folderId = state.tracks.find((t) => t.id === trackId)?.parentTrackId
        if (folderId) setTracks(ungroupFolderTracks(state.tracks, folderId))
      },

      selectLayer: (id, additive) => {
        const selection = useSelectionStore.getState()
        if (!id) {
          selection.clearSelection()
          return
        }
        if (additive) {
          const current = selection.selectedItemIds
          selection.selectItems(
            current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
          )
          return
        }
        selection.selectItems([id])
      },

      updateTransform: (id, patch) => {
        const item = useItemsStore.getState().items.find((it) => it.id === id)
        if (!item) return
        updateItem(id, { transform: { ...item.transform, ...patch } })
      },

      updateShape: (id, patch) => updateItem(id, patch),

      updateText: (id, patch) => updateItem(id, patch),

      applyPreset: (id, preset) => {
        const item = useItemsStore.getState().items.find((it) => it.id === id)
        if (!item || !isCreatorItem(item)) return
        const track = buildPresetKeyframes(preset, item, comp.durationInFrames)
        removeKeyframesForProperty(id, track.property)
        addKeyframes(
          track.keyframes.map((k) => ({
            itemId: id,
            property: track.property,
            frame: k.frame,
            value: k.value,
            easing: k.easing,
          })),
        )
      },

      clearAnimation: (id) => removeKeyframesForItem(id),

      setDuration: (frames) => {
        const duration = Math.max(1, Math.round(frames))
        const layerItems = useItemsStore.getState().items.filter(isCreatorItem)
        for (const item of layerItems) updateItem(item.id, { durationInFrames: duration })
        updateMeta({ durationInFrames: duration })
        clampPlayhead(duration)
      },

      setCanvas: (w, h) =>
        updateMeta({ width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) }),

      setPlayhead: (frame) => {
        setIsPlaying(false)
        usePlaybackStore
          .getState()
          .setCurrentFrame(Math.max(0, Math.min(frame, comp.durationInFrames - 1)))
      },

      setPlaying: (playing) => setIsPlaying(playing),

      advance: (deltaSeconds) => {
        const cf = usePlaybackStore.getState().currentFrame
        usePlaybackStore
          .getState()
          .setCurrentFrame((cf + deltaSeconds * comp.fps) % comp.durationInFrames)
      },

      setName: (name) => updateMeta({ name }),

      undo: () => useTimelineCommandStore.getState().undo(),
      redo: () => useTimelineCommandStore.getState().redo(),
      canUndo,
      canRedo,
    }
  }, [
    comp.id,
    comp.width,
    comp.height,
    comp.fps,
    comp.durationInFrames,
    comp.name,
    layers,
    layerTree,
    selectedId,
    selectedIds,
    currentFrame,
    isPlaying,
    canUndo,
    canRedo,
  ])
}
