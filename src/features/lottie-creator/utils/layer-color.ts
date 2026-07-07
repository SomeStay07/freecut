/**
 * Color used to identify a layer in the layers timeline (outliner swatch +
 * timing bar fill). Prefers the layer's own paint so the bar visually matches
 * what's on canvas; falls back to a stable palette entry by index for layers
 * with no meaningful paint (e.g. a shape that hasn't been given a fill yet).
 */
import type { ShapeItem, TextItem } from '@/types/timeline'
import { pickColor } from './presets'

export function getLayerColor(item: ShapeItem | TextItem, index: number): string {
  const paint = item.type === 'shape' ? item.fillColor : item.color
  return paint || pickColor(index)
}
