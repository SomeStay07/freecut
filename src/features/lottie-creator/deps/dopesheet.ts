/**
 * Adapter for the keyframes feature's dopesheet viewport/ruler/playhead
 * building blocks — reused by the in-editor Lottie layers timeline so it
 * shares the exact same zoom/pan/ruler/playhead behavior as the clip
 * dopesheet. Cross-feature access goes through this deps/ module.
 */
export { useDopesheetViewport } from '@/features/keyframes/components/dopesheet-editor/use-dopesheet-viewport'
export {
  getFrameAxisX,
  getFrameFromAxisX,
} from '@/features/keyframes/components/dopesheet-editor/layout'
export { DopesheetRulerHeader } from '@/features/keyframes/components/dopesheet-editor/dopesheet-ruler-header'
export { DopesheetPlayheadLine } from '@/features/keyframes/components/dopesheet-editor/dopesheet-playhead-line'
export type { Viewport } from '@/features/keyframes/components/dopesheet-editor/dopesheet-types'
