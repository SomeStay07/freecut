/**
 * Cross-feature contract for the keyframes feature's dopesheet
 * viewport/ruler/playhead building blocks — reused by the in-editor Lottie
 * layers timeline so it shares the exact same zoom/pan/ruler/playhead behavior
 * as the clip dopesheet. All `@/features/keyframes/*` imports live here (per the
 * deps contract boundary rule); the sibling `dopesheet.ts` re-exports from this
 * file.
 */
export { useDopesheetViewport } from '@/features/keyframes/components/dopesheet-editor/use-dopesheet-viewport'
export {
  getFrameAxisX,
  getFrameFromAxisX,
  getVisibleKeyframeX,
} from '@/features/keyframes/components/dopesheet-editor/layout'
export { DopesheetRulerHeader } from '@/features/keyframes/components/dopesheet-editor/dopesheet-ruler-header'
export { DopesheetPlayheadLine } from '@/features/keyframes/components/dopesheet-editor/dopesheet-playhead-line'
export { PropertyTimelineCell } from '@/features/keyframes/components/dopesheet-editor/dopesheet-timeline-cells'
export type {
  Viewport,
  KeyframeMeta,
} from '@/features/keyframes/components/dopesheet-editor/dopesheet-types'
export type { BlockedFrameRange } from '@/features/keyframes/utils/transition-region'
export type { SegmentEasingChange } from '@/features/keyframes/components/dopesheet-editor/segment-easing-popover'
