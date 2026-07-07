/**
 * Recursive outliner for the creator's nested layer/folder tree. Folders (from
 * `isGroup` tracks) are collapsible headers; layers are selectable rows indented
 * by depth. Collapse is view-only (local state in the surface) so it never lands
 * in the document/undo history. Selection is additive on ctrl/cmd/shift-click,
 * feeding the multi-select that "Group" consumes.
 *
 * Any row can be dragged to reorder among its siblings or reparent in/out of a
 * folder (via `useLayerTreeDnd`); a plain click still selects because the drag
 * only starts past a threshold and clicks are gated on `didDrag()`. Interactive
 * controls (chevron / ungroup / trash) stop pointer-down propagation so they
 * don't start a drag.
 *
 * The tree is flattened to an ordered list of visible rows and virtualized, so a
 * composition with hundreds of layers only mounts a viewport's worth of rows.
 * DnD stays correct because `useLayerTreeDnd` resolves drop targets by pointer
 * hit-testing (`elementFromPoint`), not by walking every rendered row.
 */
import { memo, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight, FolderOpen, Ungroup, Trash2 } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import type { LayerTreeNode } from '../utils/folder-tree'
import type { DropTarget } from '../utils/reorder-tree'
import { useLayerTreeDnd, TREE_INDENT_PX } from '../hooks/use-layer-tree-dnd'
import { LayerRowContextMenu, type LayerTreeMenuActions } from './layer-row-context-menu'

const BASE_PADDING_PX = 8
/** Fallback row height before measurement (a row is ~28px + the 4px gap). */
const ROW_ESTIMATE_PX = 32

interface CreatorLayerTreeProps {
  nodes: LayerTreeNode[]
  selectedIds: Set<string>
  collapsedFolders: Set<string>
  onToggleFolder: (folderTrackId: string) => void
  onSelectLayer: (itemId: string, additive: boolean) => void
  onRemoveLayer: (itemId: string) => void
  onUngroupFolder: (folderTrackId: string) => void
  onMoveTrack: (sourceTrackId: string, target: DropTarget) => void
  menu: LayerTreeMenuActions
}

interface FlatRow {
  node: LayerTreeNode
  depth: number
}

/** Depth-first flatten to the currently-visible rows (collapsed folders hide children). */
function flattenVisible(
  nodes: LayerTreeNode[],
  collapsedFolders: Set<string>,
  depth = 0,
  out: FlatRow[] = [],
): FlatRow[] {
  for (const node of nodes) {
    out.push({ node, depth })
    if (node.type === 'folder' && !collapsedFolders.has(node.trackId) && node.children.length > 0) {
      flattenVisible(node.children, collapsedFolders, depth + 1, out)
    }
  }
  return out
}

function stopPointer(event: React.PointerEvent) {
  event.stopPropagation()
}

interface LayerTreeRowProps {
  node: LayerTreeNode
  depth: number
  isSelected: boolean
  isCollapsed: boolean
  isDragging: boolean
  menu: LayerTreeMenuActions
  onToggleFolder: (folderTrackId: string) => void
  onSelectLayer: (itemId: string, additive: boolean) => void
  onRemoveLayer: (itemId: string) => void
  onUngroupFolder: (folderTrackId: string) => void
  onRowPointerDown: (trackId: string, name: string, event: React.PointerEvent) => void
  didDrag: () => boolean
}

const LayerTreeRow = memo(function LayerTreeRow({
  node,
  depth,
  isSelected,
  isCollapsed,
  isDragging,
  menu,
  onToggleFolder,
  onSelectLayer,
  onRemoveLayer,
  onUngroupFolder,
  onRowPointerDown,
  didDrag,
}: LayerTreeRowProps) {
  const paddingLeft = BASE_PADDING_PX + depth * TREE_INDENT_PX

  if (node.type === 'folder') {
    return (
      <LayerRowContextMenu menu={menu} isFolder folderTrackId={node.trackId} canUngroup>
        <div
          data-track-id={node.trackId}
          data-depth={depth}
          data-folder="1"
          onPointerDown={(event) => onRowPointerDown(node.trackId, node.name, event)}
          className={cn(
            'group flex cursor-grab items-center gap-1.5 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted active:cursor-grabbing',
            isDragging && 'opacity-40',
          )}
          style={{ paddingLeft }}
        >
          <button
            type="button"
            onPointerDown={stopPointer}
            onClick={() => onToggleFolder(node.trackId)}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded hover:text-foreground"
            aria-label={isCollapsed ? 'Expand folder' : 'Collapse folder'}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 truncate font-medium">{node.name}</span>
          <button
            type="button"
            onPointerDown={stopPointer}
            onClick={() => onUngroupFolder(node.trackId)}
            className="shrink-0 opacity-0 hover:text-foreground group-hover:opacity-100"
            aria-label="Ungroup folder"
            title="Ungroup"
          >
            <Ungroup className="h-3.5 w-3.5" />
          </button>
        </div>
      </LayerRowContextMenu>
    )
  }

  const { item } = node
  return (
    <LayerRowContextMenu menu={menu} isFolder={false} folderTrackId="" canUngroup={depth > 0}>
      <div
        data-track-id={node.trackId}
        data-depth={depth}
        data-folder="0"
        onPointerDown={(event) => onRowPointerDown(node.trackId, item.label, event)}
        onContextMenu={() => {
          if (!isSelected) onSelectLayer(item.id, false)
        }}
        onClick={(event) => {
          if (didDrag()) return
          onSelectLayer(item.id, event.ctrlKey || event.metaKey || event.shiftKey)
        }}
        className={cn(
          'group flex cursor-grab items-center gap-2 rounded py-1.5 pr-2 text-left text-xs active:cursor-grabbing',
          isSelected ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-muted',
          isDragging && 'opacity-40',
        )}
        style={{ paddingLeft }}
      >
        <span
          className="h-3 w-3 shrink-0 rounded-sm border border-border"
          style={{ backgroundColor: item.type === 'shape' ? item.fillColor : item.color }}
        />
        <span className="flex-1 truncate">{item.label}</span>
        <Trash2
          className="h-3 w-3 opacity-0 hover:text-red-500 group-hover:opacity-100"
          onPointerDown={stopPointer}
          onClick={(event) => {
            event.stopPropagation()
            onRemoveLayer(item.id)
          }}
        />
      </div>
    </LayerRowContextMenu>
  )
})

export function CreatorLayerTree({
  nodes,
  selectedIds,
  collapsedFolders,
  onToggleFolder,
  onSelectLayer,
  onRemoveLayer,
  onUngroupFolder,
  onMoveTrack,
  menu,
}: CreatorLayerTreeProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { dragSourceId, dropIndicator, dragLabel, onRowPointerDown, didDrag } = useLayerTreeDnd({
    containerRef: wrapperRef,
    onMove: onMoveTrack,
  })

  const rows = useMemo(() => flattenVisible(nodes, collapsedFolders), [nodes, collapsedFolders])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => wrapperRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 12,
    getItemKey: (index) => rows[index]?.node.trackId ?? index,
  })

  return (
    <div ref={wrapperRef} className="relative min-h-0 flex-1 overflow-y-auto">
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index]
          if (!row) return null
          const trackId = row.node.trackId
          const itemId = row.node.type === 'layer' ? row.node.item.id : ''
          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute top-0 right-0 left-0 pb-1"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <LayerTreeRow
                node={row.node}
                depth={row.depth}
                isSelected={itemId ? selectedIds.has(itemId) : false}
                isCollapsed={collapsedFolders.has(trackId)}
                isDragging={dragSourceId === trackId}
                menu={menu}
                onToggleFolder={onToggleFolder}
                onSelectLayer={onSelectLayer}
                onRemoveLayer={onRemoveLayer}
                onUngroupFolder={onUngroupFolder}
                onRowPointerDown={onRowPointerDown}
                didDrag={didDrag}
              />
            </div>
          )
        })}

        {dropIndicator?.lineTop != null && (
          <div
            className="pointer-events-none absolute z-10 h-0.5 rounded-full bg-primary"
            style={{ top: dropIndicator.lineTop - 1, left: dropIndicator.lineLeft, right: 4 }}
          />
        )}
        {dropIndicator?.folderTop != null && (
          <div
            className="pointer-events-none absolute inset-x-1 z-10 rounded ring-2 ring-primary/70"
            style={{ top: dropIndicator.folderTop, height: dropIndicator.folderHeight }}
          />
        )}
      </div>

      {dragLabel && (
        <div
          className="pointer-events-none fixed z-50 rounded border border-border bg-popover px-2 py-1 text-xs text-foreground shadow-md"
          style={{ left: dragLabel.x + 12, top: dragLabel.y + 8 }}
        >
          {dragLabel.name}
        </div>
      )}
    </div>
  )
}
