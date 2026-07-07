/**
 * Fused multi-layer keyframe timeline skeleton (Increment 1) for the in-editor
 * Lottie creator — an After-Effects-style layer stack sharing one frame
 * viewport/ruler/playhead across every layer. This increment only renders the
 * outliner + per-layer colored timing bars (move/trim); keyframe sub-rows land
 * in a later increment.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import type { ShapeItem, TextItem, TimelineItem } from '@/types/timeline'
import { getLayerColor } from '../utils/layer-color'
import { useLayerBarDrag } from '../hooks/use-layer-bar-drag'
import { useItemsStore, type SubComposition } from '../deps/timeline'
import {
  DopesheetPlayheadLine,
  DopesheetRulerHeader,
  getFrameAxisX,
  getFrameFromAxisX,
  useDopesheetViewport,
  type Viewport,
} from '../deps/dopesheet'

const OUTLINER_WIDTH = 208
const ROW_HEIGHT = 40
const BAR_HEIGHT = 26
const TICK_COUNT = 9

type LayerItem = ShapeItem | TextItem

function isLayerItem(item: TimelineItem): item is LayerItem {
  return item.type === 'shape' || item.type === 'text'
}

function clampFrame(frame: number, totalFrames: number): number {
  return Math.max(0, Math.min(totalFrames - 1, Math.round(frame)))
}

interface LayerRowProps {
  item: LayerItem
  index: number
  compDuration: number
  viewport: Viewport
  timelineWidth: number
  frameToX: (frame: number) => number
  isSelected: boolean
  isCollapsed: boolean
  onToggleCollapse: (itemId: string) => void
}

function LayerRow({
  item,
  index,
  compDuration,
  viewport,
  timelineWidth,
  frameToX,
  isSelected,
  isCollapsed,
  onToggleCollapse,
}: LayerRowProps) {
  const color = getLayerColor(item, index)
  const {
    mode,
    previewFrom,
    previewDurationInFrames,
    onBodyPointerDown,
    onTrimLeftPointerDown,
    onTrimRightPointerDown,
  } = useLayerBarDrag({
    itemId: item.id,
    from: item.from,
    durationInFrames: item.durationInFrames,
    compDuration,
    viewport,
    timelineWidth,
  })

  const left = frameToX(previewFrom)
  const width = Math.max(2, frameToX(previewFrom + previewDurationInFrames) - left)

  return (
    <div
      className="grid border-b border-border/60"
      style={{ gridTemplateColumns: `${OUTLINER_WIDTH}px 1fr`, height: ROW_HEIGHT }}
    >
      <div
        className={cn('flex items-center gap-1.5 px-1.5 text-xs', isSelected && 'bg-primary/10')}
      >
        <button
          type="button"
          onClick={() => onToggleCollapse(item.id)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          aria-label={isCollapsed ? 'Expand layer' : 'Collapse layer'}
        >
          {isCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm border border-border"
          style={{ backgroundColor: color }}
        />
        <span className="truncate">{item.label}</span>
      </div>

      <div className="relative border-l border-border/60">
        <div
          onPointerDown={onBodyPointerDown}
          className={cn(
            'absolute top-1/2 -translate-y-1/2 rounded-sm border cursor-grab active:cursor-grabbing',
            mode === 'move' && 'cursor-grabbing',
          )}
          style={{
            left,
            width,
            height: BAR_HEIGHT,
            backgroundColor: `${color}55`,
            borderColor: color,
          }}
        >
          <div
            onPointerDown={onTrimLeftPointerDown}
            className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize"
          />
          <div
            onPointerDown={onTrimRightPointerDown}
            className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
          />
        </div>
      </div>
    </div>
  )
}

export function LottieLayersTimeline({ comp }: { comp: SubComposition }) {
  const items = useItemsStore((s) => s.items)
  const tracks = useItemsStore((s) => s.tracks)
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const selectedItemId = useSelectionStore((s) => s.selectedItemIds[0] ?? null)

  const layers = useMemo(() => {
    const orderByTrackId = new Map(tracks.map((t) => [t.id, t.order]))
    return items
      .filter(isLayerItem)
      .slice()
      .sort((a, b) => (orderByTrackId.get(a.trackId) ?? 0) - (orderByTrackId.get(b.trackId) ?? 0))
  }, [items, tracks])

  const [collapsedByItemId, setCollapsedByItemId] = useState<Map<string, boolean>>(new Map())
  const toggleCollapse = useCallback((itemId: string) => {
    setCollapsedByItemId((prev) => {
      const next = new Map(prev)
      next.set(itemId, !(prev.get(itemId) ?? false))
      return next
    })
  }, [])

  const timelineRef = useRef<HTMLDivElement>(null)
  const [timelineWidth, setTimelineWidth] = useState(0)
  useEffect(() => {
    const node = timelineRef.current
    if (!node) return
    const update = () => setTimelineWidth(node.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const { viewport } = useDopesheetViewport({
    itemId: comp.id,
    totalFrames: comp.durationInFrames,
    keyframeFrameBounds: null,
    frameViewport: undefined,
    onFrameViewportChange: undefined,
  })

  const frameToX = useCallback(
    (frame: number) => getFrameAxisX(frame, viewport, timelineWidth),
    [viewport, timelineWidth],
  )

  const rulerDraggingRef = useRef(false)
  const scrubToClientX = useCallback(
    (clientX: number) => {
      const frame = clampFrame(
        getFrameFromAxisX(clientX, viewport, timelineWidth),
        comp.durationInFrames,
      )
      usePlaybackStore.getState().setCurrentFrame(frame)
    },
    [viewport, timelineWidth, comp.durationInFrames],
  )
  const onRulerPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      rulerDraggingRef.current = true
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // ignore pointer capture errors
      }
      scrubToClientX(event.clientX)
    },
    [scrubToClientX],
  )
  const onRulerPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!rulerDraggingRef.current) return
      scrubToClientX(event.clientX)
    },
    [scrubToClientX],
  )
  const onRulerPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    rulerDraggingRef.current = false
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // ignore pointer capture errors
    }
  }, [])

  const propertyGridStyle = useMemo(
    () => ({ display: 'grid', gridTemplateColumns: `${OUTLINER_WIDTH}px 1fr` }) as const,
    [],
  )

  const rulerTickElements = useMemo(() => {
    const range = Math.max(1, viewport.endFrame - viewport.startFrame)
    const frames = new Set<number>()
    for (let i = 0; i <= TICK_COUNT; i++) {
      frames.add(Math.round(viewport.startFrame + (range * i) / TICK_COUNT))
    }
    return [...frames].map((frame) => (
      <div
        key={frame}
        className="absolute inset-y-0 border-l border-border/60"
        style={{ left: Math.round(frameToX(frame)) }}
      >
        <span className="absolute top-0.5 left-1 text-[10px] text-muted-foreground">{frame}</span>
      </div>
    ))
  }, [viewport, frameToX])

  const timelineContentLeft = OUTLINER_WIDTH + 1
  const maxLeft = Math.max(0, timelineWidth - 1)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <DopesheetRulerHeader
        propertyGridStyle={propertyGridStyle}
        timelineRef={timelineRef}
        onRulerPointerDown={onRulerPointerDown}
        onRulerPointerMove={onRulerPointerMove}
        onRulerPointerUp={onRulerPointerUp}
        rulerTickElements={rulerTickElements}
        playheadFlag={
          <DopesheetPlayheadLine
            variant="flag"
            relativeFrame={currentFrame}
            itemFrom={0}
            totalFrames={comp.durationInFrames}
            frameToX={frameToX}
            maxLeft={maxLeft}
            className="absolute top-0 bottom-0 pointer-events-none z-10"
          />
        }
      />

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {layers.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No layers yet
          </div>
        ) : (
          layers.map((item, index) => (
            <LayerRow
              key={item.id}
              item={item}
              index={index}
              compDuration={comp.durationInFrames}
              viewport={viewport}
              timelineWidth={timelineWidth}
              frameToX={frameToX}
              isSelected={item.id === selectedItemId}
              isCollapsed={collapsedByItemId.get(item.id) ?? false}
              onToggleCollapse={toggleCollapse}
            />
          ))
        )}

        {layers.length > 0 && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 overflow-hidden"
            style={{ left: timelineContentLeft }}
          >
            <DopesheetPlayheadLine
              relativeFrame={currentFrame}
              itemFrom={0}
              totalFrames={comp.durationInFrames}
              frameToX={frameToX}
              maxLeft={maxLeft}
              className="absolute top-0 bottom-0"
            />
          </div>
        )}
      </div>
    </div>
  )
}
