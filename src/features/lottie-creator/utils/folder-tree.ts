/**
 * Folder tree for the Lottie creator's layer stack (Option B: in-place nestable
 * grouping within one `kind:'lottie'` sub-composition).
 *
 * A folder is a `TimelineTrack` with `isGroup: true` (no item); a layer is a
 * track carrying one shape/text item. Nesting is expressed by `parentTrackId`,
 * and sibling z-order by track `order` (lower = higher in the stack, matching
 * the creator's flat convention). Keeping folders in the same comp means every
 * edit action / undo / keyframe path works unchanged — folders are flattened
 * into native Lottie precomps only at export time.
 *
 * These are pure array transforms (no store access) so grouping/ungrouping is
 * unit-testable and commits as a single `setTracks` undo step.
 */
import type { ShapeItem, TextItem, TimelineItem, TimelineTrack } from '@/types/timeline'

type LayerItem = ShapeItem | TextItem

function isLayerItem(item: TimelineItem): item is LayerItem {
  return item.type === 'shape' || item.type === 'text'
}

export interface LayerTreeLeaf {
  type: 'layer'
  trackId: string
  item: LayerItem
}

export interface LayerTreeFolder {
  type: 'folder'
  trackId: string
  name: string
  collapsed: boolean
  children: LayerTreeNode[]
}

export type LayerTreeNode = LayerTreeLeaf | LayerTreeFolder

const ROOT = ''

/**
 * Build the nested layer tree from the flat items + tracks. Siblings are sorted
 * by track `order` (ascending = top). Group tracks become folders (recursing
 * into their children); tracks carrying a shape/text item become leaves; empty
 * non-group tracks are skipped.
 */
export function buildLayerTree(items: TimelineItem[], tracks: TimelineTrack[]): LayerTreeNode[] {
  const itemByTrackId = new Map<string, LayerItem>()
  for (const item of items) {
    if (isLayerItem(item)) itemByTrackId.set(item.trackId, item)
  }

  const childrenByParent = new Map<string, TimelineTrack[]>()
  for (const track of tracks) {
    const key = track.parentTrackId ?? ROOT
    const list = childrenByParent.get(key)
    if (list) list.push(track)
    else childrenByParent.set(key, [track])
  }
  for (const list of childrenByParent.values()) list.sort((a, b) => a.order - b.order)

  const build = (parentKey: string): LayerTreeNode[] => {
    const out: LayerTreeNode[] = []
    for (const track of childrenByParent.get(parentKey) ?? []) {
      if (track.isGroup) {
        out.push({
          type: 'folder',
          trackId: track.id,
          name: track.name,
          collapsed: track.isCollapsed ?? false,
          children: build(track.id),
        })
      } else {
        const item = itemByTrackId.get(track.id)
        if (item) out.push({ type: 'layer', trackId: track.id, item })
      }
    }
    return out
  }

  return build(ROOT)
}

/**
 * Wrap `memberTrackIds` into a new folder track. The folder is placed at the
 * members' shared parent (or the root if they differ) and takes the topmost
 * member's order, so it lands where the selection was. Members keep their
 * relative order under the new folder. Returns a fresh tracks array; the caller
 * commits it via `setTracks`.
 */
export function groupTracksIntoFolder(
  tracks: TimelineTrack[],
  memberTrackIds: string[],
  folderTrackId: string,
  folderName: string,
): TimelineTrack[] {
  const memberSet = new Set(memberTrackIds)
  const members = tracks.filter((t) => memberSet.has(t.id))
  if (members.length === 0) return tracks

  const parents = new Set(members.map((t) => t.parentTrackId ?? ROOT))
  const parentTrackId = parents.size === 1 ? [...parents][0]! : ROOT
  const folderOrder = Math.min(...members.map((t) => t.order))

  const folderTrack: TimelineTrack = {
    id: folderTrackId,
    name: folderName,
    kind: 'video',
    height: members[0]!.height,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: folderOrder,
    isGroup: true,
    parentTrackId: parentTrackId === ROOT ? undefined : parentTrackId,
    items: [],
  }

  const reparented = tracks.map((t) =>
    memberSet.has(t.id) ? { ...t, parentTrackId: folderTrackId } : t,
  )
  return [...reparented, folderTrack]
}

/**
 * Dissolve a folder: its direct children are reparented up to the folder's own
 * parent (preserving order), and the folder track is dropped. Nested folders
 * inside it simply rise one level intact. Returns a fresh tracks array.
 */
export function ungroupFolder(tracks: TimelineTrack[], folderTrackId: string): TimelineTrack[] {
  const folder = tracks.find((t) => t.id === folderTrackId && t.isGroup)
  if (!folder) return tracks

  const grandparent = folder.parentTrackId
  return tracks
    .filter((t) => t.id !== folderTrackId)
    .map((t) => (t.parentTrackId === folderTrackId ? { ...t, parentTrackId: grandparent } : t))
}
