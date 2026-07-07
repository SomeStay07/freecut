/**
 * Lottie Creator layer model — a shape/text layer plus its keyframe tracks. The
 * in-editor creator surface and its composition adapter share these, deriving
 * them from (and writing them back to) the `kind:'lottie'` sub-composition.
 */
import type { ShapeItem, TextItem } from './timeline'
import type { PropertyKeyframes } from './keyframe'

/** A creator layer wraps a shape or text item (both Lottie-native). */
export type CreatorItem = ShapeItem | TextItem

export interface CreatorLayer {
  item: CreatorItem
  /** Keyframe tracks for this layer, by property. */
  properties: PropertyKeyframes[]
}
