/**
 * Builds the shared layer/folder context-menu actions from a `CreatorController`
 * + the clipboard state, so the outliner and the timeline show the same,
 * selection-aware Group/Ungroup/Copy/Paste/Duplicate/Delete menu.
 */
import { useMemo } from 'react'
import type { CreatorController } from '../components/lottie-creator-surface'
import type { LayerTreeMenuActions } from '../components/layer-row-context-menu'
import { useCreatorClipboardStore } from '../stores/creator-clipboard'

export function useLayerMenu(controller: CreatorController): LayerTreeMenuActions {
  const canPaste = useCreatorClipboardStore((s) => s.layers.length > 0)
  const selectedIds = controller.selectedIds
  return useMemo<LayerTreeMenuActions>(
    () => ({
      selectedCount: selectedIds.length,
      canPaste,
      groupSelection: () => controller.groupLayers(selectedIds),
      ungroupFolder: (folderTrackId) => controller.ungroupFolder(folderTrackId),
      ungroupSelection: () => controller.ungroupSelection(),
      copy: () => controller.copyLayers(selectedIds),
      paste: () => controller.pasteLayers(),
      duplicate: () => controller.duplicateLayers(selectedIds),
      remove: () => controller.removeLayers(selectedIds),
    }),
    [selectedIds, canPaste, controller],
  )
}
