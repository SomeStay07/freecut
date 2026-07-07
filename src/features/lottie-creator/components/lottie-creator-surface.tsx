/**
 * Presentational Lottie authoring surface — the rich creator UI (add
 * shapes/text, layer list, transform gizmo, properties, motion presets,
 * templates, transport) with NO store of its own. It is driven entirely by a
 * `CreatorController`: a state + actions bundle that either the standalone
 * creator store or the in-editor composition adapter supplies.
 *
 * The two differing header controls (leading = back / Done; trailing = Save /
 * export) are injected as render props so the same surface serves both the
 * dedicated `/lottie` route and the in-editor "enter-to-edit" mode.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Circle,
  FileJson,
  Heart,
  Hexagon,
  LayoutTemplate,
  Pause,
  Play,
  Plus,
  Redo2,
  Square,
  Star,
  Triangle,
  Type,
  Trash2,
  Undo2,
} from 'lucide-react'
import type { ShapeItem, ShapeType, TextItem } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TransformProperties } from '@/types/transform'
import type { CreatorLayer } from '@/types/lottie-creation'
import type { LayerTreeNode } from '../utils/folder-tree'
import { buildLottieDocument } from '@/infrastructure/lottie/export'
import { Button } from '@/components/ui/button'
import type { PresetKind } from '../utils/presets'
import { useCoordParams } from '../hooks/use-coord-params'
import { CREATOR_FONT, ensureCreatorFont } from '../utils/creator-font'
import { LottieLivePreview } from './lottie-live-preview'
import { CreatorTransformGizmo } from './creator-transform-gizmo'
import { CreatorLayerHitAreas } from './creator-layer-hit-areas'
import { TemplateGallery, type TemplateDocument } from './template-gallery'

/** The built Lottie document handed to the header slots. */
type LottieDocument = ReturnType<typeof buildLottieDocument>['document']

/**
 * Everything the surface needs to read and mutate a Lottie document. Backed by
 * either the standalone zustand store or the composition store — the surface is
 * blind to which. `undo`/`redo` are optional (the standalone provides them; the
 * composition path omits them for now).
 */
export interface CreatorController {
  width: number
  height: number
  fps: number
  durationInFrames: number
  /** Top-first: index 0 renders as the topmost Lottie layer. */
  layers: CreatorLayer[]
  /** Nested layer/folder tree (top-first) for the outliner + timeline. */
  layerTree: LayerTreeNode[]
  selectedId: string | null
  playhead: number
  isPlaying: boolean
  name: string
  addShape: (shapeType: ShapeType) => void
  addText: () => void
  loadTemplate: (doc: TemplateDocument) => void
  removeLayer: (id: string) => void
  /** Wrap the given layers (by item id) into a new folder. */
  groupLayers: (layerIds: string[]) => void
  /** Dissolve a folder track, raising its children one level. */
  ungroupFolder: (folderTrackId: string) => void
  selectLayer: (id: string | null) => void
  updateTransform: (id: string, patch: Partial<TransformProperties>) => void
  updateShape: (id: string, patch: Partial<ShapeItem>) => void
  updateText: (id: string, patch: Partial<TextItem>) => void
  applyPreset: (id: string, preset: PresetKind) => void
  clearAnimation: (id: string) => void
  setDuration: (frames: number) => void
  setCanvas: (width: number, height: number) => void
  setPlayhead: (frame: number) => void
  setPlaying: (playing: boolean) => void
  advance: (deltaSeconds: number) => void
  setName: (name: string) => void
  undo?: () => void
  redo?: () => void
  canUndo?: boolean
  canRedo?: boolean
}

const SHAPE_TOOLS: Array<{ type: ShapeType; label: string; Icon: typeof Square }> = [
  { type: 'rectangle', label: 'Rectangle', Icon: Square },
  { type: 'ellipse', label: 'Ellipse', Icon: Circle },
  { type: 'triangle', label: 'Triangle', Icon: Triangle },
  { type: 'star', label: 'Star', Icon: Star },
  { type: 'polygon', label: 'Polygon', Icon: Hexagon },
  { type: 'heart', label: 'Heart', Icon: Heart },
]

const PRESETS: Array<{ kind: PresetKind; label: string }> = [
  { kind: 'spin', label: 'Spin' },
  { kind: 'fadeIn', label: 'Fade in' },
  { kind: 'slideIn', label: 'Slide in' },
  { kind: 'pulse', label: 'Pulse' },
]

const CANVAS_PRESETS = [
  { label: '512²', width: 512, height: 512 },
  { label: '1080²', width: 1080, height: 1080 },
  { label: '1920×1080', width: 1920, height: 1080 },
]

const CHECKER_STYLE = {
  backgroundColor: '#2a2a2a',
  backgroundImage:
    'linear-gradient(45deg, #3a3a3a 25%, transparent 25%), linear-gradient(-45deg, #3a3a3a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3a3a3a 75%), linear-gradient(-45deg, transparent 75%, #3a3a3a 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0',
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 rounded border border-border bg-background px-2 py-1 text-right tabular-nums outline-none focus:border-primary"
      />
    </label>
  )
}

export function LottieCreatorSurface({
  controller,
  renderLeading,
  renderTrailing,
  renderDock,
}: {
  controller: CreatorController
  /** Header start control (back link / Done button). Receives the built doc. */
  renderLeading: (doc: LottieDocument) => ReactNode
  /** Header end control (Save .json / export). Receives the built doc. */
  renderTrailing?: (doc: LottieDocument) => ReactNode
  /** Bottom dock rendered below the 3-pane row (e.g. the keyframe graph panel). */
  renderDock?: () => ReactNode
}) {
  const { width, height, fps, durationInFrames, layers, selectedId, playhead, isPlaying, name } =
    controller

  const { data, doc, warnings } = useMemo(() => {
    const items = layers.map((layer) => layer.item)
    const keyframes: Record<string, ItemKeyframes> = {}
    for (const layer of layers) {
      if (layer.properties.length > 0) {
        keyframes[layer.item.id] = { itemId: layer.item.id, properties: layer.properties }
      }
    }
    const result = buildLottieDocument(items, {
      fps,
      width,
      height,
      durationInFrames,
      name: name || 'Lottie Creation',
      fontName: CREATOR_FONT,
      keyframes,
    })
    return {
      data: JSON.stringify(result.document),
      doc: result.document,
      warnings: result.warnings,
    }
  }, [layers, fps, width, height, durationInFrames, name])

  // Playback loop — advance the playhead in real time (looping at duration).
  // Read `advance` through a ref so the loop doesn't re-subscribe when the
  // controller object is rebuilt each render.
  const advanceRef = useRef(controller.advance)
  advanceRef.current = controller.advance
  useEffect(() => {
    if (!isPlaying) return
    let raf = 0
    let prev = performance.now()
    const tick = (now: number) => {
      const dt = (now - prev) / 1000
      prev = now
      advanceRef.current(dt)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying])

  // Undo/redo shortcuts — only intercept when the controller actually provides
  // handlers (the in-editor path has none, so Ctrl+Z passes through untouched).
  const undoRef = useRef(controller.undo)
  undoRef.current = controller.undo
  const redoRef = useRef(controller.redo)
  redoRef.current = controller.redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && undoRef.current) {
        e.preventDefault()
        if (e.shiftKey) redoRef.current?.()
        else undoRef.current()
      } else if (key === 'y' && redoRef.current) {
        e.preventDefault()
        redoRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Register the text font once; bump the token when it lands so the preview
  // rebuilds and any text renders (instead of blank).
  const [fontEpoch, setFontEpoch] = useState(0)
  useEffect(() => {
    let active = true
    void ensureCreatorFont().then((ok) => {
      if (active && ok) setFontEpoch((e) => e + 1)
    })
    return () => {
      active = false
    }
  }, [])

  const selected = layers.find((layer) => layer.item.id === selectedId) ?? null
  const selectedItem = selected?.item ?? null
  const transform = selectedItem?.transform ?? {}
  const hasAnimation = (selected?.properties.length ?? 0) > 0

  const previewBoxRef = useRef<HTMLDivElement>(null)
  const coordParams = useCoordParams(previewBoxRef, width, height)
  const [templatesOpen, setTemplatesOpen] = useState(false)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
        {renderLeading(doc)}
        <FileJson className="h-4 w-4 text-primary" />
        <input
          value={name}
          onChange={(e) => controller.setName(e.target.value)}
          aria-label="Creation name"
          className="w-48 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-medium hover:border-border focus:border-primary focus:bg-background focus:outline-none"
        />

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setTemplatesOpen(true)}
        >
          <LayoutTemplate className="h-4 w-4" />
          Templates
        </Button>

        <div className="ml-4 flex items-center gap-1">
          {CANVAS_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => controller.setCanvas(preset.width, preset.height)}
              className={`rounded px-2 py-1 text-xs ${
                width === preset.width && height === preset.height
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <label className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          Duration
          <input
            type="number"
            value={durationInFrames}
            min={1}
            step={1}
            onChange={(e) => controller.setDuration(Number(e.target.value))}
            className="w-16 rounded border border-border bg-background px-2 py-1 text-right tabular-nums outline-none focus:border-primary"
          />
          <span>f</span>
        </label>

        <div className="ml-auto flex items-center gap-2">
          {controller.undo && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={!controller.canUndo}
                onClick={() => controller.undo?.()}
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={!controller.canRedo}
                onClick={() => controller.redo?.()}
                title="Redo (Ctrl+Shift+Z)"
              >
                <Redo2 className="h-4 w-4" />
              </Button>
            </>
          )}
          {warnings.length > 0 && (
            <span
              className="text-xs text-amber-500"
              title={warnings.map((w) => w.message).join('\n')}
            >
              {warnings.length} note(s)
            </span>
          )}
          {renderTrailing?.(doc)}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          {/* Left: add + layers */}
          <aside className="flex w-56 shrink-0 flex-col border-r border-border">
            <div className="border-b border-border p-2">
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Add shape
              </div>
              <div className="grid grid-cols-3 gap-1">
                {SHAPE_TOOLS.map(({ type, label, Icon }) => (
                  <button
                    key={type}
                    onClick={() => controller.addShape(type)}
                    title={label}
                    className="flex flex-col items-center gap-1 rounded border border-border py-2 text-[10px] text-muted-foreground hover:border-primary hover:text-foreground"
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => controller.addText()}
                className="mt-1 flex w-full items-center justify-center gap-1.5 rounded border border-border py-1.5 text-[11px] text-muted-foreground hover:border-primary hover:text-foreground"
              >
                <Type className="h-3.5 w-3.5" />
                Text
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <Plus className="h-3 w-3" /> Layers
              </div>
              {layers.length === 0 && (
                <div className="px-1 py-4 text-center text-xs text-muted-foreground">
                  No layers yet — add a shape above.
                </div>
              )}
              <ul className="space-y-1">
                {layers.map((layer) => (
                  <li key={layer.item.id}>
                    <button
                      onClick={() => controller.selectLayer(layer.item.id)}
                      className={`group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
                        layer.item.id === selectedId
                          ? 'bg-primary/15 text-foreground'
                          : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-sm border border-border"
                        style={{
                          backgroundColor:
                            layer.item.type === 'shape' ? layer.item.fillColor : layer.item.color,
                        }}
                      />
                      <span className="flex-1 truncate">{layer.item.label}</span>
                      {layer.properties.length > 0 && (
                        <span className="text-[9px] text-primary">anim</span>
                      )}
                      <Trash2
                        className="h-3 w-3 opacity-0 hover:text-red-500 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation()
                          controller.removeLayer(layer.item.id)
                        }}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* Center: preview + transport */}
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
              <div
                ref={previewBoxRef}
                className="relative flex max-h-full max-w-full items-center justify-center rounded-lg"
                style={{
                  aspectRatio: `${width} / ${height}`,
                  width: 'min(100%, 70vh)',
                  ...CHECKER_STYLE,
                }}
              >
                {layers.length > 0 ? (
                  <LottieLivePreview
                    data={data}
                    frame={playhead}
                    reloadToken={fontEpoch}
                    className="h-full w-full"
                  />
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Add a shape or text to begin.
                  </span>
                )}
                {coordParams && !isPlaying && layers.length > 0 && (
                  <CreatorLayerHitAreas
                    items={layers.map((layer) => layer.item)}
                    selectedId={selectedId}
                    coordParams={coordParams}
                    onSelect={controller.selectLayer}
                  />
                )}
                {coordParams && selectedItem && (
                  <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
                    <CreatorTransformGizmo
                      item={selectedItem}
                      coordParams={coordParams}
                      hidden={isPlaying}
                      onTransformStart={() => controller.setPlaying(false)}
                      onTransformEnd={(next) =>
                        controller.updateTransform(selectedItem.id, {
                          x: next.x,
                          y: next.y,
                          width: next.width,
                          height: next.height,
                          rotation: next.rotation,
                        })
                      }
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => controller.setPlaying(!isPlaying)}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <input
                type="range"
                min={0}
                max={Math.max(0, durationInFrames - 1)}
                step={1}
                value={Math.round(playhead)}
                onChange={(e) => {
                  controller.setPlaying(false)
                  controller.setPlayhead(Number(e.target.value))
                }}
                className="flex-1 accent-primary"
              />
              <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">
                {Math.round(playhead)} / {durationInFrames - 1} · {fps}fps
              </span>
            </div>
          </main>

          {/* Right: properties + presets */}
          <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-l border-border p-3">
            {!selectedItem ? (
              <div className="text-center text-xs text-muted-foreground">
                Select a layer to edit its properties.
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Transform
                  </div>
                  <div className="space-y-1.5">
                    <NumberField
                      label="X"
                      value={transform.x ?? 0}
                      onChange={(v) => controller.updateTransform(selectedItem.id, { x: v })}
                    />
                    <NumberField
                      label="Y"
                      value={transform.y ?? 0}
                      onChange={(v) => controller.updateTransform(selectedItem.id, { y: v })}
                    />
                    <NumberField
                      label="Width"
                      value={transform.width ?? 0}
                      min={1}
                      onChange={(v) => controller.updateTransform(selectedItem.id, { width: v })}
                    />
                    <NumberField
                      label="Height"
                      value={transform.height ?? 0}
                      min={1}
                      onChange={(v) => controller.updateTransform(selectedItem.id, { height: v })}
                    />
                    <NumberField
                      label="Rotation"
                      value={transform.rotation ?? 0}
                      onChange={(v) => controller.updateTransform(selectedItem.id, { rotation: v })}
                    />
                    <label className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Opacity</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={transform.opacity ?? 1}
                        onChange={(e) =>
                          controller.updateTransform(selectedItem.id, {
                            opacity: Number(e.target.value),
                          })
                        }
                        className="w-24 accent-primary"
                      />
                    </label>
                  </div>
                </div>

                {selectedItem.type === 'text' ? (
                  <div>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Text
                    </div>
                    <textarea
                      value={selectedItem.text}
                      onChange={(e) =>
                        controller.updateText(selectedItem.id, { text: e.target.value })
                      }
                      rows={2}
                      className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                    />
                    <div className="mt-1.5 space-y-1.5">
                      <NumberField
                        label="Font size"
                        value={selectedItem.fontSize ?? 72}
                        min={4}
                        onChange={(v) => controller.updateText(selectedItem.id, { fontSize: v })}
                      />
                      <label className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">Color</span>
                        <input
                          type="color"
                          value={selectedItem.color}
                          onChange={(e) =>
                            controller.updateText(selectedItem.id, { color: e.target.value })
                          }
                          className="h-7 w-14 cursor-pointer rounded border border-border bg-background"
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Fill
                    </div>
                    <label className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Color</span>
                      <input
                        type="color"
                        value={selectedItem.fillColor}
                        onChange={(e) =>
                          controller.updateShape(selectedItem.id, { fillColor: e.target.value })
                        }
                        className="h-7 w-14 cursor-pointer rounded border border-border bg-background"
                      />
                    </label>
                  </div>
                )}

                <div>
                  <div className="mb-2 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Motion
                    {hasAnimation && (
                      <button
                        onClick={() => controller.clearAnimation(selectedItem.id)}
                        className="text-[10px] normal-case text-muted-foreground hover:text-foreground"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {PRESETS.map(({ kind, label }) => (
                      <button
                        key={kind}
                        onClick={() => controller.applyPreset(selectedItem.id, kind)}
                        className="rounded border border-border px-2 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
                    Presets stamp keyframes. Combine them (e.g. Spin + Fade in) — each survives the
                    round trip to real Lottie.
                  </p>
                </div>
              </div>
            )}
          </aside>
        </div>
        {renderDock && (
          <div className="min-h-0 shrink-0 border-t border-border" style={{ height: 420 }}>
            {renderDock()}
          </div>
        )}
      </div>

      <TemplateGallery
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        onPick={controller.loadTemplate}
      />
    </div>
  )
}
