/**
 * Drag/resize/rotate gizmo for a selected creator shape.
 *
 * A shape-only distillation of the editor's `TransformGizmo`: it reuses the same
 * interaction store, coordinate math, window-drag lifecycle, and handle
 * rendering, but reads the displayed pose from the shape's own `transform`
 * (base pose — creator layers aren't in the timeline keyframe/playback stores)
 * and commits the result back through `onTransformEnd`. Committing once on
 * release keeps each drag a single undo step and triggers one live-Lottie
 * rebuild (during the drag only the lightweight handle box moves).
 */
import { useCallback, useMemo } from 'react'
import type { ShapeItem, TextItem } from '@/types/timeline'
import {
  GizmoHandles,
  attachWindowTransformInteraction,
  getScaleCursor,
  getScreenTransformOrigin,
  screenToCanvas,
  transformToScreenBounds,
  useEscapeCancel,
  useGizmoStore,
  useItemGizmoPreview,
  type CoordinateParams,
  type GizmoHandle,
  type Transform,
} from '../deps/gizmo'

function resolveBasePose(item: ShapeItem | TextItem): Transform {
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

interface CreatorTransformGizmoProps {
  item: ShapeItem | TextItem
  coordParams: CoordinateParams
  onTransformStart: () => void
  onTransformEnd: (transform: Transform, operation: 'move' | 'resize' | 'rotate') => void
  /** Hide (during playback) without unmounting. */
  hidden?: boolean
}

export function CreatorTransformGizmo({
  item,
  coordParams,
  onTransformStart,
  onTransformEnd,
  hidden = false,
}: CreatorTransformGizmoProps) {
  const { activeGizmo, previewTransform } = useItemGizmoPreview(item.id)
  const startTranslate = useGizmoStore((s) => s.startTranslate)
  const startScale = useGizmoStore((s) => s.startScale)
  const startRotate = useGizmoStore((s) => s.startRotate)
  const updateInteraction = useGizmoStore((s) => s.updateInteraction)
  const endInteraction = useGizmoStore((s) => s.endInteraction)
  const clearInteraction = useGizmoStore((s) => s.clearInteraction)
  const cancelInteraction = useGizmoStore((s) => s.cancelInteraction)

  const isInteracting = activeGizmo?.itemId === item.id

  const currentTransform = useMemo(
    (): Transform => (isInteracting && previewTransform ? previewTransform : resolveBasePose(item)),
    [isInteracting, previewTransform, item],
  )

  const strokeWidth = item.type === 'shape' ? (item.strokeWidth ?? 0) : 0

  const screenBounds = useMemo(() => {
    const bounds = transformToScreenBounds(currentTransform, coordParams)
    if (strokeWidth > 0) {
      const scale = coordParams.playerSize.width / coordParams.projectSize.width
      const screenStroke = strokeWidth * scale
      bounds.left -= screenStroke / 2
      bounds.top -= screenStroke / 2
      bounds.width += screenStroke
      bounds.height += screenStroke
    }
    return bounds
  }, [currentTransform, coordParams, strokeWidth])

  const transformOrigin = useMemo(
    () => getScreenTransformOrigin(currentTransform, coordParams),
    [currentTransform, coordParams],
  )

  const toCanvasPoint = useCallback(
    (e: React.MouseEvent | MouseEvent) => screenToCanvas(e.clientX, e.clientY, coordParams),
    [coordParams],
  )

  const afterFinish = useCallback(() => {
    // Wait two frames before clearing the gizmo preview so the committed
    // transform has re-rendered — otherwise the box snaps back to the stale pose.
    requestAnimationFrame(() => requestAnimationFrame(() => clearInteraction()))
  }, [clearInteraction])

  const handleTranslateStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      const startTransform = { ...currentTransform }
      startTranslate(item.id, toCanvasPoint(e), currentTransform, strokeWidth)
      onTransformStart()
      document.body.style.cursor = 'move'
      attachWindowTransformInteraction({
        toCanvasPoint,
        updateInteraction,
        startTransform,
        endInteraction,
        onTransformEnd,
        operation: 'move',
        afterFinish,
      })
    },
    [
      item.id,
      currentTransform,
      strokeWidth,
      toCanvasPoint,
      startTranslate,
      updateInteraction,
      endInteraction,
      onTransformStart,
      onTransformEnd,
      afterFinish,
    ],
  )

  const handleScaleStart = useCallback(
    (handle: GizmoHandle, e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      const startTransform = { ...currentTransform }
      startScale(
        item.id,
        handle,
        toCanvasPoint(e),
        currentTransform,
        item.type,
        item.transform?.aspectRatioLocked,
        strokeWidth,
      )
      onTransformStart()
      document.body.style.cursor = getScaleCursor(handle, currentTransform.rotation)
      attachWindowTransformInteraction({
        toCanvasPoint,
        updateInteraction,
        startTransform,
        endInteraction,
        onTransformEnd,
        operation: 'resize',
        afterFinish,
      })
    },
    [
      item.id,
      item.type,
      item.transform?.aspectRatioLocked,
      currentTransform,
      strokeWidth,
      toCanvasPoint,
      startScale,
      updateInteraction,
      endInteraction,
      onTransformStart,
      onTransformEnd,
      afterFinish,
    ],
  )

  const handleRotateStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      const startTransform = { ...currentTransform }
      startRotate(item.id, toCanvasPoint(e), currentTransform, strokeWidth)
      onTransformStart()
      document.body.style.cursor = 'crosshair'
      attachWindowTransformInteraction({
        toCanvasPoint,
        updateInteraction,
        startTransform,
        endInteraction,
        onTransformEnd,
        operation: 'rotate',
        afterFinish,
      })
    },
    [
      item.id,
      currentTransform,
      strokeWidth,
      toCanvasPoint,
      startRotate,
      updateInteraction,
      endInteraction,
      onTransformStart,
      onTransformEnd,
      afterFinish,
    ],
  )

  useEscapeCancel(
    isInteracting,
    useCallback(() => {
      cancelInteraction()
      document.body.style.cursor = ''
    }, [cancelInteraction]),
  )

  return (
    <div
      className="absolute"
      style={{
        left: screenBounds.left,
        top: screenBounds.top,
        width: screenBounds.width,
        height: screenBounds.height,
        transform: `rotate(${currentTransform.rotation}deg)`,
        transformOrigin,
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? 'none' : 'auto',
        zIndex: 100,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <GizmoHandles
        bounds={screenBounds}
        rotation={currentTransform.rotation}
        isInteracting={isInteracting}
        onTranslateStart={handleTranslateStart}
        onScaleStart={handleScaleStart}
        onRotateStart={handleRotateStart}
      />
    </div>
  )
}
