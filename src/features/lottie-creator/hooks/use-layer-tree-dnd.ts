/**
 * Pointer drag-and-drop for the creator's layer/folder outliner.
 *
 * Dragging any row reorders it among its siblings or reparents it in/out of a
 * folder. A row's pointer-down starts *tracking*; the drag only begins once the
 * pointer passes a small threshold, so a plain click still selects (callers gate
 * their click on `didDrag()`). While dragging, `dropIndicator` describes where
 * the row would land — a horizontal insertion line for before/after, or a folder
 * highlight for "inside" — in the scroll container's content coordinates so it
 * tracks scroll. Drop bands: layer rows split 50/50 (before/after); folder rows
 * reserve the middle for "inside". Commit happens on pointer-up via `onMove`;
 * illegal drops are filtered by the pure `moveTrackInTree`.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { DropPosition, DropTarget } from '../utils/reorder-tree'

const DRAG_THRESHOLD_PX = 4
export const TREE_INDENT_PX = 12
const TREE_BASE_PADDING_PX = 8

export interface DropIndicator {
  refTrackId: string
  position: DropPosition
  /** before/after: y of the insertion line (content coords). */
  lineTop?: number
  lineLeft?: number
  /** inside: highlight box (content coords). */
  folderTop?: number
  folderHeight?: number
}

interface DragState {
  sourceId: string
  name: string
  pointerId: number
  startX: number
  startY: number
  started: boolean
}

interface UseLayerTreeDndOptions {
  containerRef: React.RefObject<HTMLElement | null>
  onMove: (sourceTrackId: string, target: DropTarget) => void
}

export interface UseLayerTreeDndResult {
  dragSourceId: string | null
  dropIndicator: DropIndicator | null
  dragLabel: { name: string; x: number; y: number } | null
  onRowPointerDown: (trackId: string, name: string, event: ReactPointerEvent) => void
  /** True if the just-finished pointer sequence was a drag (so callers skip the click). */
  didDrag: () => boolean
}

export function useLayerTreeDnd({
  containerRef,
  onMove,
}: UseLayerTreeDndOptions): UseLayerTreeDndResult {
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null)
  const [dragLabel, setDragLabel] = useState<{ name: string; x: number; y: number } | null>(null)

  const stateRef = useRef<DragState | null>(null)
  const didDragRef = useRef(false)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => cleanupRef.current?.(), [])

  const resolve = useCallback(
    (clientX: number, clientY: number): { target: DropTarget; indicator: DropIndicator } | null => {
      const container = containerRef.current
      const state = stateRef.current
      if (!container || !state) return null

      const row = document
        .elementFromPoint(clientX, clientY)
        ?.closest<HTMLElement>('[data-track-id]')
      if (!row) return null
      const refTrackId = row.dataset.trackId
      if (!refTrackId || refTrackId === state.sourceId) return null

      const isFolder = row.dataset.folder === '1'
      const depth = Number(row.dataset.depth ?? 0)
      const rect = row.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      const relY = (clientY - rect.top) / Math.max(1, rect.height)

      let position: DropPosition
      if (isFolder) position = relY < 0.28 ? 'before' : relY > 0.72 ? 'after' : 'inside'
      else position = relY < 0.5 ? 'before' : 'after'

      const top = rect.top - containerRect.top + container.scrollTop
      if (position === 'inside') {
        return {
          target: { refTrackId, position },
          indicator: { refTrackId, position, folderTop: top, folderHeight: rect.height },
        }
      }
      return {
        target: { refTrackId, position },
        indicator: {
          refTrackId,
          position,
          lineTop: position === 'before' ? top : top + rect.height,
          lineLeft: TREE_BASE_PADDING_PX + depth * TREE_INDENT_PX,
        },
      }
    },
    [containerRef],
  )

  const endDrag = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    stateRef.current = null
    setDragSourceId(null)
    setDropIndicator(null)
    setDragLabel(null)
  }, [])

  const onRowPointerDown = useCallback(
    (trackId: string, name: string, event: ReactPointerEvent) => {
      if (event.button !== 0) return
      didDragRef.current = false
      stateRef.current = {
        sourceId: trackId,
        name,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        started: false,
      }

      const handleMove = (moveEvent: globalThis.PointerEvent) => {
        const state = stateRef.current
        if (!state || state.pointerId !== moveEvent.pointerId) return
        if (!state.started) {
          const dx = Math.abs(moveEvent.clientX - state.startX)
          const dy = Math.abs(moveEvent.clientY - state.startY)
          if (dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) return
          state.started = true
          didDragRef.current = true
          setDragSourceId(state.sourceId)
        }
        setDragLabel({ name: state.name, x: moveEvent.clientX, y: moveEvent.clientY })
        setDropIndicator(resolve(moveEvent.clientX, moveEvent.clientY)?.indicator ?? null)
      }

      const handleUp = (upEvent: globalThis.PointerEvent) => {
        const state = stateRef.current
        if (!state || state.pointerId !== upEvent.pointerId) return
        if (state.started) {
          const result = resolve(upEvent.clientX, upEvent.clientY)
          if (result) onMove(state.sourceId, result.target)
        }
        endDrag()
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleUp)
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleUp)
      }
    },
    [endDrag, onMove, resolve],
  )

  const didDrag = useCallback(() => didDragRef.current, [])

  return { dragSourceId, dropIndicator, dragLabel, onRowPointerDown, didDrag }
}
