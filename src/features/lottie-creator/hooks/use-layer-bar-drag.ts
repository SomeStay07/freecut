/**
 * Pointer interaction for a single layer's timing bar in the layers timeline:
 * drag the body to move the layer, or drag either edge to trim it. The drag is
 * kept entirely local (no store writes) until pointer-up, which commits once —
 * a single undo step — via `updateItem`.
 */
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { getFrameFromAxisX, type Viewport } from '../deps/dopesheet'
import { updateItem } from '../deps/timeline'

export type LayerBarDragMode = 'move' | 'trim-left' | 'trim-right' | null

interface UseLayerBarDragOptions {
  itemId: string
  from: number
  durationInFrames: number
  compDuration: number
  viewport: Viewport
  timelineWidth: number
}

interface UseLayerBarDragResult {
  /** Raw pointer pixel delta since drag start (0 when idle). */
  dragOffsetPx: number
  mode: LayerBarDragMode
  /** Provisional bar start, reflecting the in-progress drag (equals `from` when idle). */
  previewFrom: number
  /** Provisional bar duration, reflecting the in-progress drag (equals `durationInFrames` when idle). */
  previewDurationInFrames: number
  onBodyPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onTrimLeftPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onTrimRightPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
}

interface DragSession {
  mode: 'move' | 'trim-left' | 'trim-right'
  pointerId: number
  startFrame: number
  startClientX: number
  origFrom: number
  origDurationInFrames: number
}

export function useLayerBarDrag({
  itemId,
  from,
  durationInFrames,
  compDuration,
  viewport,
  timelineWidth,
}: UseLayerBarDragOptions): UseLayerBarDragResult {
  const [mode, setMode] = useState<LayerBarDragMode>(null)
  const [preview, setPreview] = useState<{ from: number; durationInFrames: number } | null>(null)
  const [dragOffsetPx, setDragOffsetPx] = useState(0)

  const sessionRef = useRef<DragSession | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  // Latest props, read from the window listeners so they never go stale mid-drag.
  const propsRef = useRef({ itemId, compDuration, viewport, timelineWidth })
  propsRef.current = { itemId, compDuration, viewport, timelineWidth }

  const endDrag = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    sessionRef.current = null
    setMode(null)
    setPreview(null)
    setDragOffsetPx(0)
  }, [])

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, dragMode: 'move' | 'trim-left' | 'trim-right') => {
      event.preventDefault()
      event.stopPropagation()

      const { viewport, timelineWidth } = propsRef.current
      const startFrame = getFrameFromAxisX(event.clientX, viewport, timelineWidth)

      const session: DragSession = {
        mode: dragMode,
        pointerId: event.pointerId,
        startFrame,
        startClientX: event.clientX,
        origFrom: from,
        origDurationInFrames: durationInFrames,
      }
      sessionRef.current = session

      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // ignore pointer capture errors (e.g. detached target)
      }

      setMode(dragMode)
      setPreview({ from: session.origFrom, durationInFrames: session.origDurationInFrames })
      setDragOffsetPx(0)

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const activeSession = sessionRef.current
        if (!activeSession || activeSession.pointerId !== moveEvent.pointerId) return

        const { compDuration, viewport, timelineWidth } = propsRef.current
        const currentFrame = getFrameFromAxisX(moveEvent.clientX, viewport, timelineWidth)
        const deltaFrames = currentFrame - activeSession.startFrame

        let nextFrom = activeSession.origFrom
        let nextDuration = activeSession.origDurationInFrames

        if (activeSession.mode === 'move') {
          const maxFrom = Math.max(0, compDuration - activeSession.origDurationInFrames)
          nextFrom = Math.min(
            maxFrom,
            Math.max(0, Math.round(activeSession.origFrom + deltaFrames)),
          )
        } else if (activeSession.mode === 'trim-left') {
          const maxFrom = activeSession.origFrom + activeSession.origDurationInFrames - 1
          nextFrom = Math.min(
            maxFrom,
            Math.max(0, Math.round(activeSession.origFrom + deltaFrames)),
          )
          nextDuration = activeSession.origFrom + activeSession.origDurationInFrames - nextFrom
        } else {
          nextDuration = Math.min(
            compDuration - activeSession.origFrom,
            Math.max(1, Math.round(activeSession.origDurationInFrames + deltaFrames)),
          )
        }

        setPreview({ from: nextFrom, durationInFrames: nextDuration })
        setDragOffsetPx(moveEvent.clientX - activeSession.startClientX)
      }

      const handlePointerUp = (upEvent: PointerEvent) => {
        const activeSession = sessionRef.current
        if (!activeSession || activeSession.pointerId !== upEvent.pointerId) return

        const { compDuration, viewport, timelineWidth } = propsRef.current
        const currentFrame = getFrameFromAxisX(upEvent.clientX, viewport, timelineWidth)
        const deltaFrames = currentFrame - activeSession.startFrame

        if (activeSession.mode === 'move') {
          const maxFrom = Math.max(0, compDuration - activeSession.origDurationInFrames)
          const nextFrom = Math.min(
            maxFrom,
            Math.max(0, Math.round(activeSession.origFrom + deltaFrames)),
          )
          if (nextFrom !== activeSession.origFrom) {
            updateItem(propsRef.current.itemId, { from: nextFrom })
          }
        } else if (activeSession.mode === 'trim-left') {
          const maxFrom = activeSession.origFrom + activeSession.origDurationInFrames - 1
          const nextFrom = Math.min(
            maxFrom,
            Math.max(0, Math.round(activeSession.origFrom + deltaFrames)),
          )
          const nextDuration =
            activeSession.origFrom + activeSession.origDurationInFrames - nextFrom
          if (
            nextFrom !== activeSession.origFrom ||
            nextDuration !== activeSession.origDurationInFrames
          ) {
            updateItem(propsRef.current.itemId, { from: nextFrom, durationInFrames: nextDuration })
          }
        } else {
          const nextDuration = Math.min(
            compDuration - activeSession.origFrom,
            Math.max(1, Math.round(activeSession.origDurationInFrames + deltaFrames)),
          )
          if (nextDuration !== activeSession.origDurationInFrames) {
            updateItem(propsRef.current.itemId, { durationInFrames: nextDuration })
          }
        }

        endDrag()
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
      }
    },
    [durationInFrames, endDrag, from],
  )

  const onBodyPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => startDrag(event, 'move'),
    [startDrag],
  )
  const onTrimLeftPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => startDrag(event, 'trim-left'),
    [startDrag],
  )
  const onTrimRightPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => startDrag(event, 'trim-right'),
    [startDrag],
  )

  return {
    dragOffsetPx,
    mode,
    previewFrom: preview?.from ?? from,
    previewDurationInFrames: preview?.durationInFrames ?? durationInFrames,
    onBodyPointerDown,
    onTrimLeftPointerDown,
    onTrimRightPointerDown,
  }
}
