/**
 * Cross-feature contract for the timeline feature's composition stores — used by
 * the in-editor Lottie workspace to read/write the active Lottie composition and
 * to enter/exit it. All `@/features/timeline/*` imports live here (per the deps
 * contract boundary rule); the sibling `timeline.ts` re-exports from this file.
 */
export { useCompositionNavigationStore } from '@/features/timeline/stores/composition-navigation-store'
export { useCompositionsStore } from '@/features/timeline/stores/compositions-store'
export type { SubComposition } from '@/features/timeline/stores/compositions-store'
export { useTimelineStore } from '@/features/timeline/stores/timeline-store'
export {
  addItemOnNewTrack,
  setTracks,
  updateItem,
  removeItems,
  addKeyframe,
  addKeyframes,
  removeKeyframes,
  removeKeyframesForItem,
  removeKeyframesForProperty,
  updateKeyframes,
} from '@/features/timeline/stores/timeline-actions'
export { useItemsStore } from '@/features/timeline/stores/items-store'
export { useKeyframesStore } from '@/features/timeline/stores/keyframes-store'
export { useKeyframeSelectionStore } from '@/features/timeline/stores/keyframe-selection-store'
export { DEFAULT_TRACK_HEIGHT } from '@/features/timeline/constants'
export { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
export { captureSnapshot } from '@/features/timeline/stores/commands/snapshot'
export type { TimelineSnapshot } from '@/features/timeline/stores/commands/types'
export { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
