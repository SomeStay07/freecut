/**
 * Cross-feature contract for the keyframes feature's value helpers — used by the
 * Lottie layers timeline to compute the base/interpolated value of a property
 * when adding a keyframe at the playhead. All `@/features/keyframes/*` imports
 * live here (per the deps contract boundary rule); the sibling `keyframes.ts`
 * re-exports from this file.
 */
export { getAnimatablePropertiesForItem } from '@/features/keyframes/utils/animatable-properties'
export { interpolatePropertyValue } from '@/features/keyframes/utils/interpolation'
export {
  getTextAnimatableBaseValue,
  isTextAnimatableProperty,
} from '@/features/keyframes/utils/animated-text-item'
export { getEffectPropertyBaseValue } from '@/features/keyframes/utils/effect-animatable-properties'
