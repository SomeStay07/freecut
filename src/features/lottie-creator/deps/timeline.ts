/**
 * Adapter for the timeline feature's composition stores — used by the in-editor
 * Lottie workspace to read/write the active Lottie composition and to
 * enter/exit it. Cross-feature access goes through this deps/ module.
 */
export { useCompositionNavigationStore } from '@/features/timeline/stores/composition-navigation-store'
export { useCompositionsStore } from '@/features/timeline/stores/compositions-store'
export type { SubComposition } from '@/features/timeline/stores/compositions-store'
export { useTimelineStore } from '@/features/timeline/stores/timeline-store'
export {
  addItemOnNewTrack,
  updateItem,
  removeItems,
  addKeyframes,
  removeKeyframesForItem,
  removeKeyframesForProperty,
  updateKeyframes,
} from '@/features/timeline/stores/timeline-actions'
export { useItemsStore } from '@/features/timeline/stores/items-store'
export { useKeyframesStore } from '@/features/timeline/stores/keyframes-store'
export { useKeyframeSelectionStore } from '@/features/timeline/stores/keyframe-selection-store'
export { DEFAULT_TRACK_HEIGHT } from '@/features/timeline/constants'
export { KeyframeGraphPanel } from '@/features/timeline/components/keyframe-graph-panel'
export { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
