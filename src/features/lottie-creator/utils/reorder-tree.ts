/**
 * Drag-and-drop reordering/reparenting for the creator's layer/folder tree.
 *
 * A drop is expressed relative to a reference row: `before`/`after` make the
 * dragged track a sibling of the reference, `inside` drops it at the top of a
 * folder. After the structural change every track's `order` is renumbered by a
 * depth-first walk of the new tree (top-first), so a track's raw `order` always
 * equals its global visual position — keeping both the per-parent tree sort and
 * the flat, order-sorted layer list (used for Lottie z-order) consistent.
 *
 * Pure array transform (no store access) so it's unit-testable and commits as a
 * single `setTracks` undo step. Illegal drops (onto itself, or a folder into its
 * own descendant) return the input unchanged.
 */
import type { TimelineTrack } from '@/types/timeline'

export type DropPosition = 'before' | 'after' | 'inside'

export interface DropTarget {
  refTrackId: string
  position: DropPosition
}

const ROOT = ''

/** Track ids of every descendant of `trackId` (not including itself). */
function collectDescendants(
  childrenByParent: Map<string, TimelineTrack[]>,
  trackId: string,
): Set<string> {
  const out = new Set<string>()
  const walk = (id: string) => {
    for (const child of childrenByParent.get(id) ?? []) {
      out.add(child.id)
      walk(child.id)
    }
  }
  walk(trackId)
  return out
}

export function moveTrackInTree(
  tracks: TimelineTrack[],
  sourceId: string,
  target: DropTarget,
): TimelineTrack[] {
  if (sourceId === target.refTrackId) return tracks

  const byId = new Map(tracks.map((t) => [t.id, t]))
  const source = byId.get(sourceId)
  const ref = byId.get(target.refTrackId)
  if (!source || !ref) return tracks

  // Children lists per parent, in current visual order.
  const childrenByParent = new Map<string, TimelineTrack[]>()
  for (const track of tracks) {
    const key = track.parentTrackId ?? ROOT
    const list = childrenByParent.get(key)
    if (list) list.push(track)
    else childrenByParent.set(key, [track])
  }
  for (const list of childrenByParent.values()) list.sort((a, b) => a.order - b.order)

  // Resolve the destination parent + insertion index among that parent's kids.
  let targetParentId: string
  let insertIndex: number
  if (target.position === 'inside') {
    if (!ref.isGroup) return tracks // only folders accept "inside"
    targetParentId = ref.id
    insertIndex = 0 // drop at the top of the folder
  } else {
    targetParentId = ref.parentTrackId ?? ROOT
    const siblings = childrenByParent.get(targetParentId) ?? []
    const refIndex = siblings.findIndex((t) => t.id === ref.id)
    insertIndex = target.position === 'before' ? refIndex : refIndex + 1
  }

  // A folder can't be dropped into itself or any of its own descendants.
  if (source.isGroup) {
    const descendants = collectDescendants(childrenByParent, sourceId)
    if (targetParentId === sourceId || descendants.has(targetParentId)) return tracks
  }

  // Remove the source from its old parent, then insert into the target parent.
  const oldParentId = source.parentTrackId ?? ROOT
  const oldSiblings = childrenByParent.get(oldParentId) ?? []
  const removedIndex = oldSiblings.findIndex((t) => t.id === sourceId)
  if (removedIndex !== -1) oldSiblings.splice(removedIndex, 1)

  // Adjust the insert index when moving down within the same parent (removing the
  // source shifts later positions left by one).
  let finalIndex = insertIndex
  if (oldParentId === targetParentId && removedIndex !== -1 && removedIndex < insertIndex) {
    finalIndex -= 1
  }

  const targetSiblings =
    targetParentId === oldParentId ? oldSiblings : (childrenByParent.get(targetParentId) ?? [])
  if (targetParentId !== oldParentId && !childrenByParent.has(targetParentId)) {
    childrenByParent.set(targetParentId, targetSiblings)
  }
  targetSiblings.splice(Math.max(0, Math.min(finalIndex, targetSiblings.length)), 0, source)

  const nextParentByTrackId = new Map<string, string | undefined>()
  nextParentByTrackId.set(sourceId, targetParentId === ROOT ? undefined : targetParentId)

  // Renumber every track by a DFS of the new forest (top-first) so raw order ==
  // global visual position.
  const orderByTrackId = new Map<string, number>()
  let counter = 0
  const assign = (parentKey: string) => {
    for (const track of childrenByParent.get(parentKey) ?? []) {
      orderByTrackId.set(track.id, counter++)
      assign(track.id)
    }
  }
  assign(ROOT)

  return tracks.map((track) => {
    const nextOrder = orderByTrackId.get(track.id)
    const patched: TimelineTrack = { ...track }
    if (nextOrder !== undefined) patched.order = nextOrder
    if (track.id === sourceId) patched.parentTrackId = nextParentByTrackId.get(sourceId)
    return patched
  })
}
