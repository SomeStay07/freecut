/**
 * Fused multi-layer keyframe timeline (Increment 2/3) for the in-editor Lottie
 * creator — an After-Effects-style layer stack sharing one frame
 * viewport/ruler/playhead across every layer. Renders the outliner +
 * per-layer colored timing bars (move/trim) plus, when a layer is expanded,
 * one keyframe sub-row per animated property (via the shared
 * `PropertyTimelineCell`). Increment 3 adds keyframe click-select
 * (ctrl/cmd-click to toggle multi-select) and drag-to-retime with a live
 * preview and a single undo commit. Increment 3b adds per-segment easing via
 * `SegmentEasingPopover` (preset click = one undo step; bezier-handle drag is
 * bracketed into a single undo step by a start-snapshot/end-commit pair,
 * mirroring the single-item dopesheet's `keyframe-graph-panel.tsx`). Increment
 * 3c adds a per-property diamond toggle (add/remove a keyframe at the playhead)
 * plus a per-layer "+" picker that starts animating any still property by
 * seeding its first keyframe with the interpolated value at the playhead.
 * Increment 3d adds marquee box-select: dragging from empty timeline space
 * rubber-bands a selection across every layer (via the shared
 * `useDopesheetMarquee` hook with a per-layer content-y geometry map), with
 * shift-add / ctrl-toggle modifiers. Property groups bucket each layer's
 * animated properties into collapsible headers (Transform/Effects/…), reusing
 * the video dopesheet's `buildGroupedPropertyStructure` + `GroupTimelineCell`
 * (aggregate diamonds, group segment easing, a group playhead ◆ toggle, and
 * click-to-select of a stacked group keyframe). Group-diamond drag-retime,
 * shift-range select and alt-duplicate are deferred.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ChevronDown, ChevronRight, Diamond, Plus } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import type { ShapeItem, TextItem, TimelineItem } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import type { AnimatableProperty, ItemKeyframes, Keyframe, KeyframeRef } from '@/types/keyframe'
import { PROPERTY_LABELS } from '@/types/keyframe'
import { getLayerColor } from '../utils/layer-color'
import { getLayerPropertyBaseValue } from '../utils/keyframe-values'
import { useLayerBarDrag } from '../hooks/use-layer-bar-drag'
import {
  useItemsStore,
  useKeyframesStore,
  useKeyframeSelectionStore,
  useTimelineCommandStore,
  useTimelineSettingsStore,
  addKeyframe,
  addKeyframes,
  removeKeyframes,
  updateKeyframes,
  captureSnapshot,
  type SubComposition,
  type TimelineSnapshot,
} from '../deps/timeline'
import { getAnimatablePropertiesForItem, interpolatePropertyValue } from '../deps/keyframes'
import {
  DopesheetPlayheadLine,
  DopesheetRulerHeader,
  GroupTimelineCell,
  KeyframeMarqueeOverlay,
  PropertyTimelineCell,
  buildGroupedPropertyStructure,
  getFrameAxisX,
  getFrameFromAxisX,
  getVisibleKeyframeX,
  useDopesheetMarquee,
  useDopesheetViewport,
  type BlockedFrameRange,
  type DopesheetPropertyGroupStructure,
  type KeyframeMeta,
  type SegmentEasingChange,
  type Viewport,
} from '../deps/dopesheet'

const OUTLINER_WIDTH = 208
const ROW_HEIGHT = 40
const KEYFRAME_ROW_HEIGHT = 28
const GROUP_HEADER_HEIGHT = 24
const BAR_HEIGHT = 26
const TICK_COUNT = 9

/** A layer's animated properties bucketed into collapsible groups (Transform/etc.). */
type PropertyGroup = DopesheetPropertyGroupStructure<{
  property: AnimatableProperty
  keyframes: Keyframe[]
}>
type FrameGroup = PropertyGroup['frameGroups'][number]

const groupKey = (itemId: string, groupId: string) => `${itemId}::${groupId}`

// Sub-rows never have transition-blocked ranges (no transitions in the Lottie
// composition timeline) or duplicate-drag preview state — reuse stable empty
// constants so PropertyTimelineCell (React.memo) doesn't see a new reference
// on every render.
const EMPTY_BLOCKED_RANGES: BlockedFrameRange[] = []
const noop = () => {}
const returnFalse = () => false

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
  playheadFrame: number
  onToggleKeyframe: (itemId: string, property: AnimatableProperty) => void
  selectedKeyframes: KeyframeRef[]
  onKeyframePointerDown: (
    itemId: string,
    property: AnimatableProperty,
    keyframeId: string,
    event: PointerEvent<HTMLButtonElement>,
  ) => void
  previewByItemId: Map<string, Record<string, number>> | null
  onSegmentEasingChange: SegmentEasingChange
  onSegmentDragStart: () => void
  onSegmentDragEnd: () => void
}

function KeyframeRow({
  itemId,
  property,
  keyframes,
  ticks,
  frameToX,
  getRenderedKeyframeX,
  accentColor,
  playheadFrame,
  onToggleKeyframe,
  selectedKeyframes,
  onKeyframePointerDown,
  previewByItemId,
  onSegmentEasingChange,
  onSegmentDragStart,
  onSegmentDragEnd,
}: KeyframeRowProps) {
  const hasKeyframeAtPlayhead = useMemo(
    () => keyframes.some((keyframe) => keyframe.frame === playheadFrame),
    [keyframes, playheadFrame],
  )
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
      <div className="flex items-center gap-1 truncate pl-4 text-[11px] text-muted-foreground">
        <button
          type="button"
          onClick={() => onToggleKeyframe(itemId, property)}
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm hover:bg-accent',
            hasKeyframeAtPlayhead ? 'text-amber-500' : 'text-muted-foreground/60',
          )}
          aria-label={
            hasKeyframeAtPlayhead ? 'Remove keyframe at playhead' : 'Add keyframe at playhead'
          }
        >
          <Diamond className={cn('h-2.5 w-2.5', hasKeyframeAtPlayhead && 'fill-current')} />
        </button>
        <span className="truncate">{PROPERTY_LABELS[property]}</span>
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
        onSegmentEasingChange={onSegmentEasingChange}
        onSegmentDragStart={onSegmentDragStart}
        onSegmentDragEnd={onSegmentDragEnd}
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
  collapsedGroups: Set<string>
  onToggleGroupCollapse: (key: string) => void
  onToggleGroupKeyframes: (itemId: string, group: PropertyGroup) => void
  onGroupKeyframePointerDown: (
    itemId: string,
    frameGroup: FrameGroup,
    event: PointerEvent<HTMLButtonElement>,
  ) => void
  playheadFrame: number
  onToggleKeyframe: (itemId: string, property: AnimatableProperty) => void
  selectedKeyframes: KeyframeRef[]
  onKeyframePointerDown: (
    itemId: string,
    property: AnimatableProperty,
    keyframeId: string,
    event: PointerEvent<HTMLButtonElement>,
  ) => void
  previewByItemId: Map<string, Record<string, number>> | null
  onSegmentEasingChange: SegmentEasingChange
  onSegmentDragStart: () => void
  onSegmentDragEnd: () => void
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
  collapsedGroups,
  onToggleGroupCollapse,
  onToggleGroupKeyframes,
  onGroupKeyframePointerDown,
  playheadFrame,
  onToggleKeyframe,
  selectedKeyframes,
  onKeyframePointerDown,
  previewByItemId,
  onSegmentEasingChange,
  onSegmentDragStart,
  onSegmentDragEnd,
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

  // Every property this layer can animate (for the "+" picker) and the subset
  // that already has keyframes (shown as a filled diamond in the picker).
  const animatableProperties = useMemo(() => getAnimatablePropertiesForItem(item), [item])
  const animatedPropertySet = useMemo(
    () => new Set(animatedProperties.map((p) => p.property)),
    [animatedProperties],
  )

  // Bucket the animated properties into collapsible groups (Transform/Effects/…),
  // exactly like the video keyframe dopesheet. Group headers show the union of
  // the group's keyframes as aggregate diamonds via GroupTimelineCell.
  const groups = useMemo(
    () => buildGroupedPropertyStructure(animatedProperties),
    [animatedProperties],
  )
  const selectedKeyframeIdsForItem = useMemo(() => {
    const ids = new Set<string>()
    for (const ref of selectedKeyframes) if (ref.itemId === item.id) ids.add(ref.keyframeId)
    return ids
  }, [selectedKeyframes, item.id])
  const sheetPreviewFramesForItem = previewByItemId?.get(item.id) ?? null

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

          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Animate a property"
                title="Animate a property"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="right" className="w-48 p-1">
              <div className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                Animate
              </div>
              <div className="max-h-64 overflow-y-auto">
                {animatableProperties.map((property) => {
                  const isAnimated = animatedPropertySet.has(property)
                  return (
                    <button
                      key={property}
                      type="button"
                      onClick={() => onToggleKeyframe(item.id, property)}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-xs hover:bg-accent"
                    >
                      <Diamond
                        className={cn(
                          'h-2.5 w-2.5 shrink-0',
                          isAnimated ? 'fill-current text-amber-500' : 'text-muted-foreground/50',
                        )}
                      />
                      <span className="truncate">{PROPERTY_LABELS[property]}</span>
                    </button>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>
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
        groups.map((group) => {
          const key = groupKey(item.id, group.id)
          const groupCollapsed = collapsedGroups.has(key)
          return (
            <div key={group.id}>
              <div
                className="grid border-b border-border/40"
                style={{
                  gridTemplateColumns: `${OUTLINER_WIDTH}px 1fr`,
                  height: GROUP_HEADER_HEIGHT,
                }}
              >
                <div className="flex items-center gap-1 truncate pl-4 text-[11px] font-medium text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => onToggleGroupCollapse(key)}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                    aria-label={groupCollapsed ? 'Expand group' : 'Collapse group'}
                  >
                    {groupCollapsed ? (
                      <ChevronRight className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleGroupKeyframes(item.id, group)}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
                    aria-label="Toggle keyframes for group at playhead"
                  >
                    <Diamond className="h-2.5 w-2.5 text-muted-foreground/70" />
                  </button>
                  <span className="truncate uppercase">{group.label}</span>
                </div>
                <GroupTimelineCell
                  itemId={item.id}
                  groupId={group.id}
                  groupLabel={group.label}
                  frameGroups={group.frameGroups}
                  rows={group.rows}
                  ticks={ticks}
                  frameToX={frameToX}
                  getRenderedKeyframeX={getRenderedKeyframeX}
                  selectedKeyframeIds={selectedKeyframeIdsForItem}
                  disabled={false}
                  isPropertyLocked={returnFalse}
                  onGroupKeyframePointerDown={(frameGroup, event) =>
                    onGroupKeyframePointerDown(item.id, frameGroup, event)
                  }
                  onBackgroundPointerDown={noop}
                  onSegmentEasingChange={onSegmentEasingChange}
                  onSegmentDragStart={onSegmentDragStart}
                  onSegmentDragEnd={onSegmentDragEnd}
                  sheetPreviewFrames={sheetPreviewFramesForItem}
                  sheetPreviewDuplicateKeyframeIds={null}
                />
              </div>

              {!groupCollapsed &&
                group.rows.map((row) => (
                  <KeyframeRow
                    key={row.property}
                    itemId={item.id}
                    property={row.property}
                    keyframes={row.keyframes}
                    ticks={ticks}
                    frameToX={frameToX}
                    getRenderedKeyframeX={getRenderedKeyframeX}
                    accentColor={color}
                    playheadFrame={playheadFrame}
                    onToggleKeyframe={onToggleKeyframe}
                    selectedKeyframes={selectedKeyframes}
                    onKeyframePointerDown={onKeyframePointerDown}
                    previewByItemId={previewByItemId}
                    onSegmentEasingChange={onSegmentEasingChange}
                    onSegmentDragStart={onSegmentDragStart}
                    onSegmentDragEnd={onSegmentDragEnd}
                  />
                ))}
            </div>
          )
        })}
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
  // Use `_updateKeyframe` directly (no undo per call) for live segment-easing drags.
  const _updateKeyframe = useKeyframesStore((s) => s._updateKeyframe)

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

  // Property groups default expanded; this Set holds the collapsed `itemId::groupId`
  // keys. Lifted here (not local to LayerRow) so the marquee geometry walk below
  // can account for which group member rows are currently visible.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const toggleGroupCollapse = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const canvas = useMemo<CanvasSettings>(
    () => ({ width: comp.width, height: comp.height, fps: comp.fps }),
    [comp.width, comp.height, comp.fps],
  )

  // Add or remove a keyframe for `property` at the playhead (also the entry point
  // for starting to animate a still property from the layer's "+" picker). Reads
  // live store state so it stays correct regardless of render timing: if a
  // keyframe already sits on the current frame it's removed, otherwise a new one
  // is created carrying the property's interpolated value at that frame (so
  // adding a keyframe never visually jumps the layer). Lottie layers are
  // full-duration (`from: 0`), so the comp playhead frame is the item-local frame
  // and there are no transition regions to block placement.
  const toggleKeyframeAtPlayhead = useCallback(
    (itemId: string, property: AnimatableProperty) => {
      const item = useItemsStore.getState().items.find((it) => it.id === itemId)
      if (!item) return

      const frame = clampFrame(usePlaybackStore.getState().currentFrame, comp.durationInFrames)
      const propKeyframes =
        useKeyframesStore
          .getState()
          .keyframesByItemId[itemId]?.properties.find((p) => p.property === property)?.keyframes ??
        []

      const existing = propKeyframes.find((keyframe) => keyframe.frame === frame)
      if (existing) {
        removeKeyframes([{ itemId, property, keyframeId: existing.id }])
        return
      }

      const value = interpolatePropertyValue(
        propKeyframes,
        frame,
        getLayerPropertyBaseValue(item, property, canvas),
      )
      addKeyframe(itemId, property, frame, value)
    },
    [comp.durationInFrames, canvas],
  )

  // Group diamond in the outliner: toggle keyframes at the playhead across every
  // property in the group. If any group property lacks a keyframe there, add to
  // all the missing ones (one undo step); otherwise every property has one, so
  // remove them all. Mirrors the video dopesheet's group toggle.
  const toggleGroupKeyframes = useCallback(
    (itemId: string, group: PropertyGroup) => {
      const item = useItemsStore.getState().items.find((it) => it.id === itemId)
      if (!item || !isLayerItem(item)) return

      const frame = clampFrame(usePlaybackStore.getState().currentFrame, comp.durationInFrames)
      const byProperty = useKeyframesStore.getState().keyframesByItemId[itemId]?.properties ?? []
      const keyframesFor = (property: AnimatableProperty) =>
        byProperty.find((p) => p.property === property)?.keyframes ?? []

      const properties = group.rows.map((row) => row.property)
      const missing = properties.filter((p) => !keyframesFor(p).some((k) => k.frame === frame))

      if (missing.length > 0) {
        addKeyframes(
          missing.map((property) => ({
            itemId,
            property,
            frame,
            value: interpolatePropertyValue(
              keyframesFor(property),
              frame,
              getLayerPropertyBaseValue(item, property, canvas),
            ),
          })),
        )
        return
      }

      const refs = properties.flatMap((property) => {
        const existing = keyframesFor(property).find((k) => k.frame === frame)
        return existing ? [{ itemId, property, keyframeId: existing.id }] : []
      })
      if (refs.length > 0) removeKeyframes(refs)
    },
    [comp.durationInFrames, canvas],
  )

  // Group diamond in the timeline (a stacked keyframe on the group header row):
  // select every keyframe parked at that frame across the group's properties,
  // with shift-add / ctrl-toggle modifiers (drag-retime of the aggregate is a
  // follow-up; the expanded member rows already drag individually).
  const handleGroupKeyframePointerDown = useCallback(
    (itemId: string, frameGroup: FrameGroup, event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()

      const refs: KeyframeRef[] = frameGroup.keyframes.map(({ property, keyframe }) => ({
        itemId,
        property,
        keyframeId: keyframe.id,
      }))
      const store = useKeyframeSelectionStore.getState()

      if (event.ctrlKey || event.metaKey) {
        for (const ref of refs) store.toggleSelection(ref)
        return
      }
      if (event.shiftKey) {
        const union = [
          ...store.selectedKeyframes,
          ...refs.filter((ref) => !store.isKeyframeSelected(ref)),
        ]
        store.selectKeyframes(union)
        return
      }
      store.selectKeyframes(refs)
    },
    [],
  )

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

  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // Marquee geometry: walk the rendered row layout once to place every keyframe
  // in the same content coordinate space the marquee drags in — x from
  // `getRenderedKeyframeX` (content-column-local, null when off-viewport), y from
  // the cumulative row top (header + one KEYFRAME_ROW_HEIGHT per animated
  // property, skipped when the layer is collapsed). `keyframeRefById` translates
  // the marquee's hit-id set back into the store's `KeyframeRef`s. This mirrors
  // exactly what `LayerRow` renders, so the hit-testing tracks the visuals.
  const {
    keyframePoints,
    keyframeRefById,
    contentHeight: layoutContentHeight,
  } = useMemo(() => {
    const points: { keyframeId: string; x: number; y: number }[] = []
    const refById = new Map<string, KeyframeRef>()
    let top = 0
    for (const layer of layers) {
      top += ROW_HEIGHT
      if (collapsedByItemId.get(layer.id) ?? false) continue
      const animated = (keyframesByItemId[layer.id]?.properties ?? []).filter(
        (p) => p.keyframes.length > 0,
      )
      for (const group of buildGroupedPropertyStructure(animated)) {
        // Group header row: its aggregate diamonds sit at each frame-group, so a
        // marquee over the header (e.g. while the group is collapsed) still hits
        // the underlying keyframes.
        const headerCenterY = top + GROUP_HEADER_HEIGHT / 2
        for (const frameGroup of group.frameGroups) {
          const x = getRenderedKeyframeX(frameGroup.frame)
          if (x === null) continue
          for (const { keyframe } of frameGroup.keyframes) {
            points.push({ keyframeId: keyframe.id, x, y: headerCenterY })
          }
        }
        top += GROUP_HEADER_HEIGHT

        const groupExpanded = !collapsedGroups.has(groupKey(layer.id, group.id))
        for (const row of group.rows) {
          const rowCenterY = top + KEYFRAME_ROW_HEIGHT / 2
          for (const keyframe of row.keyframes) {
            refById.set(keyframe.id, {
              itemId: layer.id,
              property: row.property,
              keyframeId: keyframe.id,
            })
            if (groupExpanded) {
              const x = getRenderedKeyframeX(keyframe.frame)
              if (x !== null) points.push({ keyframeId: keyframe.id, x, y: rowCenterY })
            }
          }
          if (groupExpanded) top += KEYFRAME_ROW_HEIGHT
        }
      }
    }
    return { keyframePoints: points, keyframeRefById: refById, contentHeight: top }
  }, [layers, keyframesByItemId, collapsedByItemId, collapsedGroups, getRenderedKeyframeX])

  const keyframePointsRef = useRef(keyframePoints)
  keyframePointsRef.current = keyframePoints
  const keyframeRefByIdRef = useRef(keyframeRefById)
  keyframeRefByIdRef.current = keyframeRefById

  const getTimelineXFromClientX = useCallback(
    (clientX: number) => {
      const node = timelineRef.current
      if (!node) return 0
      const rect = node.getBoundingClientRect()
      return Math.max(0, Math.min(timelineWidth, clientX - rect.left))
    },
    [timelineWidth],
  )

  const getContentYFromClientY = useCallback(
    (clientY: number) => {
      const node = scrollAreaRef.current
      if (!node) return 0
      const rect = node.getBoundingClientRect()
      const y = clientY - rect.top + node.scrollTop
      return Math.max(0, Math.min(Math.max(0, layoutContentHeight), y))
    },
    [layoutContentHeight],
  )

  // Translate the marquee's hit keyframe-ids back to the store's refs. Reads the
  // ref map (not the memo value) so the window listeners never see a stale map.
  const handleMarqueeSelectionChange = useCallback((ids: Set<string>) => {
    const refs: KeyframeRef[] = []
    for (const id of ids) {
      const ref = keyframeRefByIdRef.current.get(id)
      if (ref) refs.push(ref)
    }
    const store = useKeyframeSelectionStore.getState()
    if (refs.length === 0) store.clearSelection()
    else store.selectKeyframes(refs)
  }, [])

  const {
    marqueeRect,
    marqueeJustEndedRef,
    getMarqueeModeFromPointerEvent,
    beginMarqueeSelection,
  } = useDopesheetMarquee({
    keyframePointsRef,
    scrollAreaRef,
    getTimelineXFromClientX,
    getContentYFromClientY,
    onSelectionChange: handleMarqueeSelectionChange,
  })

  // Start a marquee from empty timeline space. Keyframe diamonds and layer timing
  // bars stopPropagation on pointer-down, so a bubbled event means empty content
  // was hit; the clientX gate rejects the outliner column (its buttons/labels
  // don't stop propagation). Base selection is the current keyframe ids so
  // shift-add / ctrl-toggle marquees extend it.
  const handleTimelineBackgroundPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      const node = timelineRef.current
      if (!node || event.clientX < node.getBoundingClientRect().left) return
      const base = new Set(
        useKeyframeSelectionStore.getState().selectedKeyframes.map((r) => r.keyframeId),
      )
      beginMarqueeSelection(
        event.pointerId,
        event.clientX,
        event.clientY,
        getMarqueeModeFromPointerEvent(event),
        base,
      )
    },
    [beginMarqueeSelection, getMarqueeModeFromPointerEvent],
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

  // Segment easing: a bezier-handle drag is bracketed into a single undo step by
  // a pre-drag snapshot + a commit on drag end (mirrors `keyframe-graph-panel.tsx`'s
  // `handleDragStart`/`handleDragEnd`); a plain preset click commits its own step
  // via `handleSegmentEasingChange` below.
  const segmentDragSnapshotRef = useRef<TimelineSnapshot | null>(null)

  const handleSegmentDragStart = useCallback(() => {
    segmentDragSnapshotRef.current = captureSnapshot()
  }, [])

  const handleSegmentDragEnd = useCallback(() => {
    const beforeSnapshot = segmentDragSnapshotRef.current
    if (beforeSnapshot) {
      useTimelineCommandStore
        .getState()
        .addUndoEntry({ type: 'MOVE_LOTTIE_KEYFRAME_GRAPH', payload: {} }, beforeSnapshot)
      useTimelineSettingsStore.getState().markDirty()
      segmentDragSnapshotRef.current = null
    }
  }, [])

  // Apply an easing change from the dopesheet's per-segment popover to explicit
  // keyframe refs. Live drag frames (`commit: false`) go through the no-undo
  // path and are bracketed by handleSegmentDragStart/handleSegmentDragEnd;
  // everything else commits its own undo entry.
  const handleSegmentEasingChange = useCallback<SegmentEasingChange>(
    (refs, updates, options) => {
      if (refs.length === 0) return

      if (options?.commit === false) {
        for (const ref of refs) {
          _updateKeyframe(ref.itemId, ref.property, ref.keyframeId, updates)
        }
        return
      }

      updateKeyframes(
        refs.map((ref) => ({
          itemId: ref.itemId,
          property: ref.property,
          keyframeId: ref.keyframeId,
          updates,
        })),
      )
    },
    [_updateKeyframe],
  )

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

      <div ref={scrollAreaRef} className="relative min-h-0 flex-1 overflow-y-auto">
        {layers.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No layers yet
          </div>
        ) : (
          // Empty content-lane pointer-downs bubble here to start a marquee;
          // diamonds/bars stopPropagation, and the clientX gate excludes the
          // outliner column.
          <div className="relative min-h-full" onPointerDown={handleTimelineBackgroundPointerDown}>
            {layers.map((item, index) => (
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
                collapsedGroups={collapsedGroups}
                onToggleGroupCollapse={toggleGroupCollapse}
                onToggleGroupKeyframes={toggleGroupKeyframes}
                onGroupKeyframePointerDown={handleGroupKeyframePointerDown}
                playheadFrame={currentFrame}
                onToggleKeyframe={toggleKeyframeAtPlayhead}
                selectedKeyframes={selectedKeyframes}
                onKeyframePointerDown={handleKeyframePointerDown}
                previewByItemId={previewByItemId}
                onSegmentEasingChange={handleSegmentEasingChange}
                onSegmentDragStart={handleSegmentDragStart}
                onSegmentDragEnd={handleSegmentDragEnd}
              />
            ))}

            {marqueeRect && !marqueeJustEndedRef.current && (
              <KeyframeMarqueeOverlay
                rect={{ ...marqueeRect, x: timelineContentLeft + marqueeRect.x }}
              />
            )}
          </div>
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
