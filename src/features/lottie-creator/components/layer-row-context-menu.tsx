/**
 * The standard right-click menu for a layer/folder row (outliner + timeline):
 * Group / Ungroup / Copy / Paste / Duplicate / Delete, each enabled by the
 * current selection and the row's context. Shared so both surfaces show the
 * exact same actions and shortcuts.
 *
 * `children` must be a single DOM element (it's the `asChild` trigger) — the
 * outliner passes its row `<div>` directly; the timeline wraps its row component
 * in a `<div>`.
 */
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

/** Selection-aware actions the row context menu invokes. */
export interface LayerTreeMenuActions {
  selectedCount: number
  canPaste: boolean
  groupSelection: () => void
  ungroupFolder: (folderTrackId: string) => void
  ungroupSelection: () => void
  copy: () => void
  paste: () => void
  duplicate: () => void
  remove: () => void
}

export function LayerRowContextMenu({
  menu,
  isFolder,
  folderTrackId,
  canUngroup,
  children,
}: {
  menu: LayerTreeMenuActions
  isFolder: boolean
  folderTrackId: string
  canUngroup: boolean
  children: React.ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem disabled={menu.selectedCount < 2} onSelect={menu.groupSelection}>
          Group
          <ContextMenuShortcut>Ctrl+G</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canUngroup}
          onSelect={() => (isFolder ? menu.ungroupFolder(folderTrackId) : menu.ungroupSelection())}
        >
          Ungroup
          <ContextMenuShortcut>Ctrl+Shift+G</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={menu.selectedCount === 0} onSelect={menu.copy}>
          Copy
          <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={!menu.canPaste} onSelect={menu.paste}>
          Paste
          <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={menu.selectedCount === 0} onSelect={menu.duplicate}>
          Duplicate
          <ContextMenuShortcut>Ctrl+D</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={menu.selectedCount === 0}
          onSelect={menu.remove}
          className="text-destructive focus:text-destructive"
        >
          Delete
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
