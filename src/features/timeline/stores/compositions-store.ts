import { create } from 'zustand'
import type { TimelineItem, TimelineTrack, ProjectMarker } from '@/types/timeline'
import type { AudioEqSettings } from '@/types/audio'
import type { Transition } from '@/types/transition'
import type { ItemKeyframes } from '@/types/keyframe'
import type { MotionLayoutInstance } from '@/types/motion-layout'
import type {
  CompositionAssetRole,
  CompositionLibraryVisibility,
  CompositionManagedBy,
} from '@/types/composition'
import { normalizeSubComposition } from '../utils/sub-composition-normalizer'

/**
 * Sub-composition data — a self-contained mini-timeline stored independently.
 * Multiple CompositionItem instances can reference the same compositionId,
 * enabling reuse of pre-comp contents across the project.
 */
export interface SubComposition {
  id: string
  name: string
  items: TimelineItem[]
  tracks: TimelineTrack[]
  transitions: Transition[]
  keyframes: ItemKeyframes[]
  fps: number
  width: number
  height: number
  durationInFrames: number
  backgroundColor?: string
  busAudioEq?: AudioEqSettings
  /** Per-sequence timeline markers (independent of Main's). */
  markers?: ProjectMarker[]
  /** Per-sequence in/out playback range. */
  inPoint?: number | null
  outPoint?: number | null
  /** Declarative source retained while this composition is editable as a Motion Layout. */
  motionLayout?: MotionLayoutInstance
  /** User-facing role. Optional on disk for backward compatibility. */
  assetRole?: CompositionAssetRole
  /** Managed assets stay out of the flat media library. */
  libraryVisibility?: CompositionLibraryVisibility
  /** Parent-owned lifecycle metadata for internal compositions. */
  managedBy?: CompositionManagedBy
}

function normalizeCompositionOwnership(compositions: SubComposition[]): SubComposition[] {
  const motionSlotOwnerByCompositionId = new Map<string, CompositionManagedBy>()

  for (const composition of compositions) {
    if (!composition.motionLayout) continue
    for (const slot of composition.motionLayout.slots) {
      if (motionSlotOwnerByCompositionId.has(slot.compositionId)) continue
      motionSlotOwnerByCompositionId.set(slot.compositionId, {
        kind: 'motion-layout-slot',
        ownerCompositionId: composition.id,
        slotId: slot.id,
      })
    }
  }

  return compositions.map((composition) => {
    if (composition.motionLayout) {
      return normalizeSubComposition({
        ...composition,
        assetRole: 'motion-layout',
        libraryVisibility: 'visible',
        managedBy: undefined,
      })
    }

    const managedBy = motionSlotOwnerByCompositionId.get(composition.id)
    if (managedBy) {
      return normalizeSubComposition({
        ...composition,
        assetRole: 'motion-slot',
        libraryVisibility: 'managed',
        managedBy,
      })
    }

    return normalizeSubComposition({
      ...composition,
      assetRole: 'compound',
      libraryVisibility: 'visible',
      managedBy: undefined,
    })
  })
}

/** Resolve the assets that belong in the user-facing media library, including legacy projects. */
export function getLibraryVisibleCompositions(
  compositions: readonly SubComposition[],
): SubComposition[] {
  const inferredManagedIds = new Set<string>()
  for (const composition of compositions) {
    for (const slot of composition.motionLayout?.slots ?? []) {
      inferredManagedIds.add(slot.compositionId)
    }
  }

  return compositions.filter(
    (composition) =>
      composition.libraryVisibility !== 'managed' && !inferredManagedIds.has(composition.id),
  )
}

function buildCompositionsMediaDependencyIds(compositions: SubComposition[]): string[] {
  const mediaIds = new Set<string>()
  for (const composition of compositions) {
    for (const item of composition.items) {
      if (item.mediaId) {
        mediaIds.add(item.mediaId)
      }
    }
  }
  return [...mediaIds].sort()
}

function buildMediaDependencyKey(mediaDependencyIds: string[]): string {
  return mediaDependencyIds.join('|')
}

interface CompositionsState {
  compositions: SubComposition[]
  compositionById: Record<string, SubComposition>
  mediaDependencyIds: string[]
  mediaDependencyVersion: number
}

interface CompositionsActions {
  addComposition: (composition: SubComposition) => void
  updateComposition: (id: string, updates: Partial<Omit<SubComposition, 'id'>>) => void
  removeComposition: (id: string) => void
  getComposition: (id: string) => SubComposition | undefined
  setCompositions: (compositions: SubComposition[]) => void
}

export const useCompositionsStore = create<CompositionsState & CompositionsActions>()(
  (set, get) => ({
    compositions: [],
    compositionById: {},
    mediaDependencyIds: [],
    mediaDependencyVersion: 0,

    addComposition: (composition) =>
      set((state) => ({
        compositions: normalizeCompositionOwnership([...state.compositions, composition]),
      })),

    updateComposition: (id, updates) =>
      set((state) => ({
        compositions: normalizeCompositionOwnership(
          state.compositions.map((c) => (c.id === id ? { ...c, ...updates } : c)),
        ),
      })),

    removeComposition: (id) =>
      set((state) => ({
        compositions: normalizeCompositionOwnership(state.compositions.filter((c) => c.id !== id)),
      })),

    getComposition: (id) => get().compositionById[id],

    setCompositions: (compositions) =>
      set({
        compositions: normalizeCompositionOwnership(compositions),
      }),
  }),
)

let prevCompositionsRef = useCompositionsStore.getState().compositions
let prevCompositionsMediaDependencyIds = useCompositionsStore.getState().mediaDependencyIds
let prevCompositionsMediaDependencyKey = buildMediaDependencyKey(prevCompositionsMediaDependencyIds)
useCompositionsStore.subscribe((state) => {
  if (state.compositions === prevCompositionsRef) {
    return
  }
  prevCompositionsRef = state.compositions
  const compositionById: Record<string, SubComposition> = {}
  for (const composition of state.compositions) {
    compositionById[composition.id] = composition
  }
  const nextMediaDependencyIds = buildCompositionsMediaDependencyIds(state.compositions)
  const nextMediaDependencyKey = buildMediaDependencyKey(nextMediaDependencyIds)
  const mediaDependencyIds =
    nextMediaDependencyKey === prevCompositionsMediaDependencyKey
      ? state.mediaDependencyIds
      : nextMediaDependencyIds
  const mediaDependencyVersion =
    nextMediaDependencyKey === prevCompositionsMediaDependencyKey
      ? state.mediaDependencyVersion
      : state.mediaDependencyVersion + 1
  prevCompositionsMediaDependencyIds = mediaDependencyIds
  prevCompositionsMediaDependencyKey = nextMediaDependencyKey
  useCompositionsStore.setState({
    compositionById,
    mediaDependencyIds: prevCompositionsMediaDependencyIds,
    mediaDependencyVersion,
  })
})
