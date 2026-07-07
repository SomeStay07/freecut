/**
 * Base-value resolution for adding a keyframe to a Lottie layer at the playhead.
 *
 * Mirrors the single-item dopesheet's `getBaseKeyframeValue`
 * (`keyframe-graph-panel.tsx`) but scoped to the only item types a Lottie layer
 * can be — `shape` and `text`. That means no crop/volume/video branches: a
 * property is resolved as an effect param, a text-animatable base, or a plain
 * transform property (via the renderer's `resolveTransform`, so the seeded value
 * matches what's on screen). The interpolated value at the playhead — accounting
 * for any keyframes the property already has — is layered on top by the caller
 * via `interpolatePropertyValue`.
 */
import type { AnimatableProperty } from '@/types/keyframe'
import { isEffectAnimatableProperty } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import {
  resolveTransform,
  getSourceDimensions,
} from '@/runtime/composition-runtime/utils/transform-resolver'
import {
  getEffectPropertyBaseValue,
  getTextAnimatableBaseValue,
  isTextAnimatableProperty,
} from '../deps/keyframes'

/** The static (keyframe-free) value of a property, matching what the renderer shows. */
export function getLayerPropertyBaseValue(
  item: TimelineItem,
  property: AnimatableProperty,
  canvas: CanvasSettings,
): number {
  if (isEffectAnimatableProperty(property)) {
    return getEffectPropertyBaseValue(item, property) ?? 0
  }

  if (item.type === 'text' && isTextAnimatableProperty(property)) {
    return getTextAnimatableBaseValue(item, property)
  }

  const resolved = resolveTransform(item, canvas, getSourceDimensions(item))
  return property in resolved ? resolved[property as keyof typeof resolved] : 0
}
