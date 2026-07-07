/**
 * Fused multi-layer keyframe timeline (Increment 2/3) for the in-editor Lottie
 * creator — an After-Effects-style layer stack sharing one frame
 * viewport/ruler/playhead across every layer. Renders the outliner +
 * per-layer colored timing bars (move/trim) plus, when a layer is expanded,
 * one keyframe sub-row per animated property (via the shared
 * `PropertyTimelineCell`). Increment 3 adds keyframe click-select
 * (ctrl/cmd-click to toggle multi-select) and drag-to-retime with a live
 * preview and a single undo commit. Shift-range select, alt-duplicate,
 * marquee box-select, segment easing and add/remove keyframes are deferred.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import type { ShapeItem, TextItem, TimelineItem } from '@/types/timeline'
import type { AnimatableProperty, ItemKeyframes, Keyframe, KeyframeRef } from '@/types/keyframe'
import { PROPERTY_LABELS } from '@/types/keyframe'
import { getLayerColor } from '../utils/layer-color'
import { useLayerBarDrag } from '../hooks/use-layer-bar-drag'
import {
  useItemsStore,
  useKeyframesStore,
  useKeyframeSelectionStore,
  updateKeyframes,
  type SubComposition,
} from '../deps/timeline'
import {
  DopesheetPlayheadLine,
  DopesheetRulerHeader,
  PropertyTimelineCell,
  getFrameAxisX,
  getFrameFromAxisX,
  getVisibleKeyframeX,
  useDopesheetViewport,
  type BlockedFrameRange,
  type KeyframeMeta,
  type Viewport,
} from '../deps/dopesheet'

const OUTLINER_WIDTH = 208
const ROW_HEIGHT = 40
const KEYFRAME_ROW_HEIGHT = 28
const BAR_HEIGHT = 26
const TICK_COUNT = 9

// Sub-rows never have transition-blocked ranges (no transitions in the Lottie
// composition timeline) or segment-easing/duplicate-drag preview state — reuse
// stable empty constants so PropertyTimelineCell (React.memo) doesn't see a
// new reference on every render.
const EMPTY_BLOCKED_RANGES: BlockedFrameRange[] = []
const noop = () => {}

type LayerItem = ShapeItem | TextItem

function isLayerItem(item: TimelineItem): item is LayerItem {
  return item.type === 'shape' || item.type === 'text'
}

function clampFrame(frame: number, totalFrames: number): number {
  return Math.max(0, Math.min(totalFrames - 1, Math.round(frame)))
}

interface KeyframeRowProps {
  itemId: string
  property: AnimatableProperty
  keyframes: Keyframe[]
  ticks: number[]
  frameToX: (frame: number) => number
  getRenderedKeyframeX: (frame: number) => number | null
  accentColor: string
  selectedKeyframes: KeyframeRef[]
  onKeyframePointerDown: (
    itemId: string,
    property: AnimatableProperty,
    keyframeId: string,
    event: PointerEvent<HTMLButtonElement>,
  ) => void
  previewByItemId: Map<string, Record<string, number>> | null
}

function KeyframeRow({
  itemId,
  property,
  keyframes,
  ticks,
  frameToX,
  getRenderedKeyframeX,
  accentColor,
  selectedKeyframes,
  onKeyframePointerDown,
  previewByItemId,
}: KeyframeRowProps) {
  const keyframeMetaByIdRef = useRef(new Map<string, KeyframeMeta>())
  const renderedKeyframeXById = useMemo(() => {
    const map = new Map<string, number>()
    for (const keyframe of keyframes) {
      const x = getRenderedKeyframeX(keyframe.frame)
      if (x !== null) map.set(keyframe.id, x)
    }
    return map
  }, [keyframes, getRenderedKeyframeX])

  // The cell only holds this property's keyframe ids, so it's harmless (and
  // cheaper) to keep this per-item rather than per-item-and-property.
  const selectedKeyframeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const ref of selectedKeyframes) {
      if (ref.itemId === itemId) ids.add(ref.keyframeId)
    }
    return ids
  }, [selectedKeyframes, itemId])

  const handleKeyframePointerDown = useCallback(
    (_property: AnimatableProperty, keyframeId: string, event: PointerEvent<HTMLButtonElement>) => {
      onKeyframePointerDown(itemId, property, keyframeId, event)
    },
    [itemId, property, onKeyframePointerDown],
  )

  const sheetPreviewFrames = previewByItemId?.get(itemId) ?? null

  return (
    <div
      className="grid border-b border-border/40"
      style={{ gridTemplateColumns: `${OUTLINER_WIDTH}px 1fr`, height: KEYFRAME_ROW_HEIGHT }}
    >
      <div className="flex items-center truncate pl-7 text-[11px] text-muted-foreground">
        {PROPERTY_LABELS[property]}
      </div>
      {/* PropertyTimelineCell's root is a height-less `relative` div that positions
          its diamonds at top:50% — render it as the DIRECT grid cell so grid
          `align-items: stretch` gives it the row height (an extra wrapper would
          leave it 0-tall and clip the diamonds). */}
      <PropertyTimelineCell
        itemId={itemId}
        property={property}
        keyframes={keyframes}
        locked={false}
        ticks={ticks}
        frameToX={frameToX}
        getRenderedKeyframeX={getRenderedKeyframeX}
        renderedKeyframeXById={renderedKeyframeXById}
        transitionBlockedRanges={EMPTY_BLOCKED_RANGES}
        selectedKeyframeIds={selectedKeyframeIds}
        disabled={false}
        onRowPointerDown={noop}
        onKeyframePointerDown={handleKeyframePointerDown}
        setKeyframeButtonRef={noop}
        keyframeMetaByIdRef={keyframeMetaByIdRef}
        sheetPreviewFrames={sheetPreviewFrames}
        sheetPreviewDuplicateKeyframeIds={null}
        accentColor={accentColor}
      />
    </div>
  )
}

interface LayerRowProps {
  item: LayerItem
  index: number
  compDuration: number
  viewport: Viewport
  timelineWidth: number
  frameToX: (frame: number) => number
  ticks: number[]
  getRenderedKeyframeX: (frame: number) => number | null
  itemKeyframes: ItemKeyframes | undefined
  isSelected: boolean
  isCollapsed: boolean
  onToggleCollapse: (itemId: string) => void
  selectedKeyframes: KeyframeRef[]
  onKeyframePointerDown: (
    itemId: string,
    property: AnimatableProperty,
    keyframeId: string,
    event: PointerEvent<HTMLButtonElement>,
  ) => void
  previewByItemId: Map<string, Record<string, number>> | null
}

function LayerRow({
  item,
  index,
  compDuration,
  viewport,
  timelineWidth,
  frameToX,
  ticks,
  getRenderedKeyframeX,
  itemKeyframes,
  isSelected,
  isCollapsed,
  onToggleCollapse,
  selectedKeyframes,
  onKeyframePointerDown,
  previewByItemId,
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

  const animatedProperties = useMemo(
    () => (itemKeyframes?.properties ?? []).filter((p) => p.keyframes.length > 0),
    [itemKeyframes],
  )

  return (
    <div>
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

      {!isCollapsed &&
        animatedProperties.map((p) => (
          <KeyframeRow
            key={p.property}
            itemId={item.id}
            property={p.property}
            keyframes={p.keyframes}
            ticks={ticks}
            frameToX={frameToX}
            getRenderedKeyframeX={getRenderedKeyframeX}
            accentColor={color}
            selectedKeyframes={selectedKeyframes}
            onKeyframePointerDown={onKeyframePointerDown}
            previewByItemId={previewByItemId}
          />
        ))}
    </div>
  )
}

export function LottieLayersTimeline({ comp }: { comp: SubComposition }) {
  const items = useItemsStore((s) => s.items)
  const tracks = useItemsStore((s) => s.tracks)
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const selectedItemId = useSelectionStore((s) => s.selectedItemIds[0] ?? null)
  const keyframesByItemId = useKeyframesStore((s) => s.keyframesByItemId)
  const selectedKeyframes = useKeyframeSelectionStore((s) => s.selectedKeyframes)

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

  const getRenderedKeyframeX = useCallback(
    (frame: number) => getVisibleKeyframeX(frame, viewport, timelineWidth),
    [viewport, timelineWidth],
  )

  // Local (non-store) drag-preview state for keyframe retiming: `previewByItemId`
  // feeds `sheetPreviewFrames` into each dragged keyframe's cell so the move is
  // rendered live without touching the store, then a single `updateKeyframes`
  // call on pointer-up commits it as one undo step.
  const [previewByItemId, setPreviewByItemId] = useState<Map<
    string,
    Record<string, number>
  > | null>(null)
  const dragRef = useRef<{
    refs: KeyframeRef[]
    initialFrameById: Map<string, number>
    startFrame: number
    pointerId: number
    moved: boolean
  } | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)

  // Latest layout, read from the window listeners so a drag stays correct
  // across re-renders (mirrors `useLayerBarDrag`'s propsRef pattern).
  const dragLayoutRef = useRef({ viewport, timelineWidth, compDuration: comp.durationInFrames })
  dragLayoutRef.current = { viewport, timelineWidth, compDuration: comp.durationInFrames }

  useEffect(() => () => dragCleanupRef.current?.(), [])

  const handleKeyframePointerDown = useCallback(
    (
      itemId: string,
      property: AnimatableProperty,
      keyframeId: string,
      event: PointerEvent<HTMLButtonElement>,
    ) => {
      event.preventDefault()
      event.stopPropagation()

      const ref: KeyframeRef = { itemId, property, keyframeId }
      const selectionStore = useKeyframeSelectionStore.getState()

      if (event.ctrlKey || event.metaKey) {
        selectionStore.toggleSelection(ref)
        return
      }
      if (!selectionStore.isKeyframeSelected(ref)) {
        selectionStore.selectKeyframe(ref)
      }

      const refs = useKeyframeSelectionStore.getState().selectedKeyframes
      const keyframesState = useKeyframesStore.getState()
      const initialFrameById = new Map<string, number>()
      for (const r of refs) {
        const frame = keyframesState.keyframesByItemId[r.itemId]?.properties
          .find((p) => p.property === r.property)
          ?.keyframes.find((k) => k.id === r.keyframeId)?.frame
        if (frame !== undefined) initialFrameById.set(r.keyframeId, frame)
      }

      const { viewport: startViewport, timelineWidth: startWidth } = dragLayoutRef.current
      const timelineLeft = () => timelineRef.current?.getBoundingClientRect().left ?? 0
      const startFrame = getFrameFromAxisX(
        event.clientX - timelineLeft(),
        startViewport,
        startWidth,
      )

      dragRef.current = {
        refs,
        initialFrameById,
        startFrame,
        pointerId: event.pointerId,
        moved: false,
      }

      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // ignore pointer capture errors (e.g. detached target)
      }

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        const session = dragRef.current
        if (!session || session.pointerId !== moveEvent.pointerId) return

        const { viewport, timelineWidth, compDuration } = dragLayoutRef.current
        const currentFrame = getFrameFromAxisX(
          moveEvent.clientX - timelineLeft(),
          viewport,
          timelineWidth,
        )
        const deltaFrames = currentFrame - session.startFrame
        if (deltaFrames !== 0) session.moved = true

        const next = new Map<string, Record<string, number>>()
        for (const r of session.refs) {
          const initialFrame = session.initialFrameById.get(r.keyframeId)
          if (initialFrame === undefined) continue
          const newFrame = clampFrame(initialFrame + deltaFrames, compDuration)
          const forItem = next.get(r.itemId) ?? {}
          forItem[r.keyframeId] = newFrame
          next.set(r.itemId, forItem)
        }
        setPreviewByItemId(next)
      }

      const handlePointerEnd = (endEvent: globalThis.PointerEvent) => {
        const session = dragRef.current
        if (!session || session.pointerId !== endEvent.pointerId) return

        if (session.moved) {
          const { viewport, timelineWidth, compDuration } = dragLayoutRef.current
          const currentFrame = getFrameFromAxisX(
            endEvent.clientX - timelineLeft(),
            viewport,
            timelineWidth,
          )
          const deltaFrames = currentFrame - session.startFrame

          const payloads = session.refs.flatMap((r) => {
            const initialFrame = session.initialFrameById.get(r.keyframeId)
            if (initialFrame === undefined) return []
            const newFrame = clampFrame(initialFrame + deltaFrames, compDuration)
            return [
              {
                itemId: r.itemId,
                property: r.property,
                keyframeId: r.keyframeId,
                updates: { frame: newFrame },
              },
            ]
          })
          if (payloads.length > 0) updateKeyframes(payloads)
        }

        dragCleanupRef.current?.()
        dragCleanupRef.current = null
        dragRef.current = null
        setPreviewByItemId(null)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerEnd)
      window.addEventListener('pointercancel', handlePointerEnd)
      dragCleanupRef.current = () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerEnd)
        window.removeEventListener('pointercancel', handlePointerEnd)
      }
    },
    [],
  )

  const rulerDraggingRef = useRef(false)
  const scrubToClientX = useCallback(
    (clientX: number) => {
      // `getFrameFromAxisX` expects an x relative to the timeline column's left
      // edge, not raw screen coords — convert via the ruler element's rect
      // (the drag hooks get away with raw clientX because they use deltas, which
      // cancel the offset; the scrub maps to an absolute frame, so it must not).
      const node = timelineRef.current
      if (!node) return
      const localX = clientX - node.getBoundingClientRect().left
      const frame = clampFrame(
        getFrameFromAxisX(localX, viewport, timelineWidth),
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

  const tickFrames = useMemo(() => {
    const range = Math.max(1, viewport.endFrame - viewport.startFrame)
    const frames = new Set<number>()
    for (let i = 0; i <= TICK_COUNT; i++) {
      frames.add(Math.round(viewport.startFrame + (range * i) / TICK_COUNT))
    }
    return [...frames]
  }, [viewport])

  const rulerTickElements = useMemo(
    () =>
      tickFrames.map((frame) => (
        <div
          key={frame}
          className="absolute inset-y-0 border-l border-border/60"
          style={{ left: Math.round(frameToX(frame)) }}
        >
          <span className="absolute top-0.5 left-1 text-[10px] text-muted-foreground">{frame}</span>
        </div>
      )),
    [tickFrames, frameToX],
  )

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
              ticks={tickFrames}
              getRenderedKeyframeX={getRenderedKeyframeX}
              itemKeyframes={keyframesByItemId[item.id]}
              isSelected={item.id === selectedItemId}
              isCollapsed={collapsedByItemId.get(item.id) ?? false}
              onToggleCollapse={toggleCollapse}
              selectedKeyframes={selectedKeyframes}
              onKeyframePointerDown={handleKeyframePointerDown}
              previewByItemId={previewByItemId}
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
