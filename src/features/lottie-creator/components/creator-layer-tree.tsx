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
 */
import { useRef } from 'react'
import { ChevronDown, ChevronRight, FolderOpen, Ungroup, Trash2 } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import type { LayerTreeNode } from '../utils/folder-tree'
import type { DropTarget } from '../utils/reorder-tree'
import { useLayerTreeDnd, TREE_INDENT_PX } from '../hooks/use-layer-tree-dnd'

const BASE_PADDING_PX = 8

interface CreatorLayerTreeProps {
  nodes: LayerTreeNode[]
  selectedIds: Set<string>
  collapsedFolders: Set<string>
  onToggleFolder: (folderTrackId: string) => void
  onSelectLayer: (itemId: string, additive: boolean) => void
  onRemoveLayer: (itemId: string) => void
  onUngroupFolder: (folderTrackId: string) => void
  onMoveTrack: (sourceTrackId: string, target: DropTarget) => void
}

interface NodeListProps extends Omit<CreatorLayerTreeProps, 'onMoveTrack'> {
  depth: number
  dragSourceId: string | null
  onRowPointerDown: (trackId: string, name: string, event: React.PointerEvent) => void
  didDrag: () => boolean
}

function stopPointer(event: React.PointerEvent) {
  event.stopPropagation()
}

function LayerTreeNodes({
  nodes,
  depth,
  selectedIds,
  collapsedFolders,
  onToggleFolder,
  onSelectLayer,
  onRemoveLayer,
  onUngroupFolder,
  dragSourceId,
  onRowPointerDown,
  didDrag,
}: NodeListProps) {
  return (
    <ul className="space-y-1">
      {nodes.map((node) => {
        if (node.type === 'folder') {
          const collapsed = collapsedFolders.has(node.trackId)
          return (
            <li key={node.trackId}>
              <div
                data-track-id={node.trackId}
                data-depth={depth}
                data-folder="1"
                onPointerDown={(event) => onRowPointerDown(node.trackId, node.name, event)}
                className={cn(
                  'group flex cursor-grab items-center gap-1.5 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted active:cursor-grabbing',
                  dragSourceId === node.trackId && 'opacity-40',
                )}
                style={{ paddingLeft: BASE_PADDING_PX + depth * TREE_INDENT_PX }}
              >
                <button
                  type="button"
                  onPointerDown={stopPointer}
                  onClick={() => onToggleFolder(node.trackId)}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded hover:text-foreground"
                  aria-label={collapsed ? 'Expand folder' : 'Collapse folder'}
                >
                  {collapsed ? (
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
              {!collapsed && node.children.length > 0 && (
                <LayerTreeNodes
                  nodes={node.children}
                  depth={depth + 1}
                  selectedIds={selectedIds}
                  collapsedFolders={collapsedFolders}
                  onToggleFolder={onToggleFolder}
                  onSelectLayer={onSelectLayer}
                  onRemoveLayer={onRemoveLayer}
                  onUngroupFolder={onUngroupFolder}
                  dragSourceId={dragSourceId}
                  onRowPointerDown={onRowPointerDown}
                  didDrag={didDrag}
                />
              )}
            </li>
          )
        }

        const { item } = node
        const isSelected = selectedIds.has(item.id)
        return (
          <li key={item.id}>
            <div
              data-track-id={node.trackId}
              data-depth={depth}
              data-folder="0"
              onPointerDown={(event) => onRowPointerDown(node.trackId, item.label, event)}
              onClick={(event) => {
                if (didDrag()) return
                onSelectLayer(item.id, event.ctrlKey || event.metaKey || event.shiftKey)
              }}
              className={cn(
                'group flex cursor-grab items-center gap-2 rounded py-1.5 pr-2 text-left text-xs active:cursor-grabbing',
                isSelected
                  ? 'bg-primary/15 text-foreground'
                  : 'text-muted-foreground hover:bg-muted',
                dragSourceId === node.trackId && 'opacity-40',
              )}
              style={{ paddingLeft: BASE_PADDING_PX + depth * TREE_INDENT_PX }}
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
          </li>
        )
      })}
    </ul>
  )
}

export function CreatorLayerTree({ onMoveTrack, ...listProps }: CreatorLayerTreeProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { dragSourceId, dropIndicator, dragLabel, onRowPointerDown, didDrag } = useLayerTreeDnd({
    containerRef: wrapperRef,
    onMove: onMoveTrack,
  })

  return (
    <div ref={wrapperRef} className="relative">
      <LayerTreeNodes
        {...listProps}
        depth={0}
        dragSourceId={dragSourceId}
        onRowPointerDown={onRowPointerDown}
        didDrag={didDrag}
      />

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
