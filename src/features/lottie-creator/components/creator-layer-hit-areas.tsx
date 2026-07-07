/**
 * Transparent click-to-select hit areas over the live-Lottie canvas.
 *
 * The creator's canvas is a single rasterized `<canvas>` (no per-shape DOM), so
 * — like the editor preview's `SelectableItem` overlay — we lay one invisible,
 * pointer-catching box per *unselected* layer, positioned from the layer's base
 * pose via the same `transformToScreenBounds` math the gizmo uses (so the hit
 * box matches what's drawn, rotation included). Clicking a box selects that
 * layer; clicking empty canvas clears the selection. The selected layer has no
 * box here — its `CreatorTransformGizmo` (rendered above) owns its pointer area.
 *
 * Boxes are z-stacked top-layer-first (layers arrive top-first) so an upper
 * shape wins the click when shapes overlap, matching the visual stacking.
 */
import type { ShapeItem, TextItem } from '@/types/timeline'
import {
  transformToScreenBounds,
  getScreenTransformOrigin,
  type CoordinateParams,
} from '../deps/gizmo'
import { resolveBasePose } from '../utils/creator-pose'

type LayerItem = ShapeItem | TextItem

interface CreatorLayerHitAreasProps {
  items: LayerItem[]
  selectedId: string | null
  coordParams: CoordinateParams
  onSelect: (id: string | null) => void
}

export function CreatorLayerHitAreas({
  items,
  selectedId,
  coordParams,
  onSelect,
}: CreatorLayerHitAreasProps) {
  return (
    <div className="absolute inset-0" onPointerDown={() => onSelect(null)}>
      {items.map((item, index) => {
        if (item.id === selectedId) return null
        const pose = resolveBasePose(item)
        const bounds = transformToScreenBounds(pose, coordParams)
        return (
          <button
            key={item.id}
            type="button"
            aria-label={`Select ${item.label}`}
            onPointerDown={(event) => {
              event.stopPropagation()
              onSelect(item.id)
            }}
            className="absolute cursor-pointer"
            style={{
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
              height: bounds.height,
              transform: `rotate(${pose.rotation}deg)`,
              transformOrigin: getScreenTransformOrigin(pose, coordParams),
              // Top layers arrive first — give them the higher z so they win
              // the click where shapes overlap. Kept below the gizmo (z 100).
              zIndex: items.length - index,
            }}
          />
        )
      })}
    </div>
  )
}
