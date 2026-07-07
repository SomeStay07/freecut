/**
 * Resolve a creator layer's base pose (its static `transform`, with the same
 * defaults the renderer/gizmo assume) into a gizmo `Transform`. Shared by the
 * transform gizmo and the canvas hit-area overlay so both position boxes
 * identically. Creator layers aren't in the timeline keyframe/playback stores,
 * so the base pose — not an animated pose — is what's on screen.
 */
import type { ShapeItem, TextItem } from '@/types/timeline'
import type { Transform } from '../deps/gizmo'

export function resolveBasePose(item: ShapeItem | TextItem): Transform {
  const t = item.transform ?? {}
  const width = t.width ?? 100
  const height = t.height ?? 100
  return {
    x: t.x ?? 0,
    y: t.y ?? 0,
    width,
    height,
    anchorX: t.anchorX ?? width / 2,
    anchorY: t.anchorY ?? height / 2,
    rotation: t.rotation ?? 0,
    opacity: t.opacity ?? 1,
    cornerRadius: t.cornerRadius ?? 0,
    aspectRatioLocked: t.aspectRatioLocked,
  }
}
