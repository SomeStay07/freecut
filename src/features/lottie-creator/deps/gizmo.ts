/**
 * Adapter for the preview feature's transform-gizmo primitives.
 *
 * The Lottie Creator reuses the engine's gizmo *mechanics* (interaction store,
 * coordinate math, window-drag lifecycle, handle rendering) but drives the
 * displayed pose from its own store and commits back via `updateTransform` — so
 * none of the preview feature's project-scoped couplings (playback frame,
 * timeline keyframes, selection/preview-bridge) come along. Cross-feature
 * access goes through this deps/ module per the boundary rules.
 */
export { useGizmoStore } from '@/features/preview/stores/gizmo-store'
export { useItemGizmoPreview } from '@/features/preview/stores/use-item-gizmo-preview'
export { GizmoHandles } from '@/features/preview/components/gizmo-handles'
export {
  transformToScreenBounds,
  screenToCanvas,
  getScaleCursor,
  getScreenTransformOrigin,
} from '@/features/preview/utils/coordinate-transform'
export { attachWindowTransformInteraction } from '@/features/preview/utils/gizmo-transform-interaction'
export { useEscapeCancel } from '@/features/preview/hooks/use-drag-interaction'
export type { GizmoHandle, Transform, CoordinateParams } from '@/features/preview/types/gizmo'
