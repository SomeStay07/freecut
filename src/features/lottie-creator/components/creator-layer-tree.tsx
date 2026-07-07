/**
 * Recursive outliner for the creator's nested layer/folder tree. Folders (from
 * `isGroup` tracks) are collapsible headers; layers are selectable rows indented
 * by depth. Collapse is view-only (local state in the surface) so it never lands
 * in the document/undo history. Selection is additive on ctrl/cmd-click, feeding
 * the multi-select that "Group" consumes.
 */
import { ChevronDown, ChevronRight, FolderOpen, Ungroup, Trash2 } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import type { LayerTreeNode } from '../utils/folder-tree'

interface CreatorLayerTreeProps {
  nodes: LayerTreeNode[]
  selectedIds: Set<string>
  collapsedFolders: Set<string>
  onToggleFolder: (folderTrackId: string) => void
  onSelectLayer: (itemId: string, additive: boolean) => void
  onRemoveLayer: (itemId: string) => void
  onUngroupFolder: (folderTrackId: string) => void
  depth?: number
}

const INDENT_PX = 12

export function CreatorLayerTree({
  nodes,
  selectedIds,
  collapsedFolders,
  onToggleFolder,
  onSelectLayer,
  onRemoveLayer,
  onUngroupFolder,
  depth = 0,
}: CreatorLayerTreeProps) {
  return (
    <ul className="space-y-1">
      {nodes.map((node) => {
        if (node.type === 'folder') {
          const collapsed = collapsedFolders.has(node.trackId)
          return (
            <li key={node.trackId}>
              <div
                className="group flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                style={{ paddingLeft: 8 + depth * INDENT_PX }}
              >
                <button
                  type="button"
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
                  onClick={() => onUngroupFolder(node.trackId)}
                  className="shrink-0 opacity-0 hover:text-foreground group-hover:opacity-100"
                  aria-label="Ungroup folder"
                  title="Ungroup"
                >
                  <Ungroup className="h-3.5 w-3.5" />
                </button>
              </div>
              {!collapsed && node.children.length > 0 && (
                <CreatorLayerTree
                  nodes={node.children}
                  selectedIds={selectedIds}
                  collapsedFolders={collapsedFolders}
                  onToggleFolder={onToggleFolder}
                  onSelectLayer={onSelectLayer}
                  onRemoveLayer={onRemoveLayer}
                  onUngroupFolder={onUngroupFolder}
                  depth={depth + 1}
                />
              )}
            </li>
          )
        }

        const { item } = node
        const isSelected = selectedIds.has(item.id)
        return (
          <li key={item.id}>
            <button
              onClick={(event) => onSelectLayer(item.id, event.ctrlKey || event.metaKey)}
              className={cn(
                'group flex w-full items-center gap-2 rounded py-1.5 pr-2 text-left text-xs',
                isSelected
                  ? 'bg-primary/15 text-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
              style={{ paddingLeft: 8 + depth * INDENT_PX }}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-sm border border-border"
                style={{ backgroundColor: item.type === 'shape' ? item.fillColor : item.color }}
              />
              <span className="flex-1 truncate">{item.label}</span>
              <Trash2
                className="h-3 w-3 opacity-0 hover:text-red-500 group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation()
                  onRemoveLayer(item.id)
                }}
              />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
