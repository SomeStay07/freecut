import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { toast } from 'sonner'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Film,
  FolderOpen,
  ImagePlus,
  Layers3,
  LayoutTemplate,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SliderInput } from '@/shared/ui/property-controls'
import { cn } from '@/shared/ui/cn'
import { useEditorStore } from '@/shared/state/editor'
import { useProjectStore } from '@/features/timeline/deps/projects'
import { importMediaLibraryService } from '@/features/timeline/deps/media-library-service'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import type {
  MotionLayoutEasing,
  MotionLayoutFrameAspect,
  MotionLayoutParameterKey,
  MotionLayoutSettings,
  MotionLayoutSlotAdjustment,
  MotionLayoutTemplateId,
} from '@/types/motion-layout'
import type { TimelineItem } from '@/types/timeline'
import { useItemsStore } from '../stores/items-store'
import { useTransitionsStore } from '../stores/transitions-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useCompositionsStore } from '../stores/compositions-store'
import { applyMotionLayout, updateMotionLayout } from '../stores/actions/motion-layout-actions'
import { buildTransitionIndexes } from '../utils/transition-indexes'
import { buildTransitionChains } from '../utils/bento-layout'
import {
  buildMotionLayoutPlan,
  closestMotionLayoutFrameAspect,
  createDefaultMotionLayoutSettings,
  MOTION_LAYOUT_FRAME_ASPECTS,
  MOTION_LAYOUT_TEMPLATE_BY_ID,
  MOTION_LAYOUT_TEMPLATES,
  resolveMotionLayoutFrameSize,
  resolveMotionLayoutSlot,
  type MotionLayoutTemplateDefinition,
} from '../utils/motion-layout'
import { MotionLayoutPreview, type MotionLayoutPreviewSlot } from './motion-layout-preview'
import { useMotionLayoutDialogStore } from './motion-layout-dialog-store'

const CATEGORY_ORDER = ['perspective', 'carousel', 'grid', 'spotlight', 'reveal', 'stack'] as const

const EASING_OPTIONS: MotionLayoutEasing[] = ['smooth', 'snappy', 'overshoot', 'spring']

interface MotionSourceEntry {
  id: string
  label: string
  mediaId?: string
  thumbnailUrl?: string
  previewSrc?: string
  type: TimelineItem['type']
  durationInFrames: number
  fps: number
}

const DEFAULT_SLOT_ADJUSTMENT: MotionLayoutSlotAdjustment = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  sourceStart: 0,
  sourceEnd: 1,
}

function resolveSlotAdjustmentWindow(
  source: MotionSourceEntry,
  layoutDurationSeconds: number,
  adjustment?: MotionLayoutSlotAdjustment,
): MotionLayoutSlotAdjustment {
  const sourceDurationSeconds = source.durationInFrames / Math.max(1, source.fps)
  const windowRatio = Math.min(1, layoutDurationSeconds / Math.max(0.01, sourceDurationSeconds))
  const sourceStart = Math.max(
    0,
    Math.min(1 - windowRatio, adjustment?.sourceStart ?? DEFAULT_SLOT_ADJUSTMENT.sourceStart),
  )
  return {
    ...DEFAULT_SLOT_ADJUSTMENT,
    ...adjustment,
    sourceStart,
    sourceEnd: sourceStart + windowRatio,
  }
}

function getItemMediaId(item: TimelineItem | undefined): string | undefined {
  return item && 'mediaId' in item && typeof item.mediaId === 'string' ? item.mediaId : undefined
}

function useMediaPosterUrls(mediaIds: readonly string[]): Map<string, string> {
  const [posterUrls, setPosterUrls] = useState<Map<string, string>>(() => new Map())
  const thumbnailIds = useMediaLibraryStore(
    useShallow((state) => {
      const result: Record<string, string | undefined> = {}
      for (const id of mediaIds) result[id] = state.mediaById[id]?.thumbnailId
      return result
    }),
  )

  useEffect(() => {
    const candidates = Object.entries(thumbnailIds).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    )
    if (candidates.length === 0) {
      setPosterUrls((current) => (current.size === 0 ? current : new Map()))
      return
    }

    let cancelled = false
    void importMediaLibraryService().then(async ({ mediaLibraryService }) => {
      const settled = await Promise.allSettled(
        candidates.map(
          async ([id, thumbnailId]) =>
            [id, await mediaLibraryService.getThumbnailBlobUrl(id, thumbnailId)] as const,
        ),
      )
      if (cancelled) return
      setPosterUrls((current) => {
        const next = new Map<string, string>()
        for (const result of settled) {
          if (result.status !== 'fulfilled') continue
          const [id, url] = result.value
          if (url) next.set(id, url)
        }
        if (next.size === current.size && [...next].every(([id, url]) => current.get(id) === url)) {
          return current
        }
        return next
      })
    })

    return () => {
      cancelled = true
    }
  }, [thumbnailIds])

  return posterUrls
}

function useMediaPreviewUrl(mediaId?: string, fallbackUrl?: string): string | undefined {
  const [url, setUrl] = useState<string | undefined>(fallbackUrl)

  useEffect(() => {
    let cancelled = false
    let createdUrl: string | null = null
    setUrl(fallbackUrl)
    if (!mediaId) return

    void importMediaLibraryService()
      .then(({ mediaLibraryService }) => mediaLibraryService.getMediaBlobUrl(mediaId))
      .then((nextUrl) => {
        if (!nextUrl) return
        createdUrl = nextUrl
        if (!cancelled) setUrl(nextUrl)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [fallbackUrl, mediaId])

  return url
}

function buildChainOrder(
  itemIds: string[],
  items: TimelineItem[],
  transitions: ReturnType<typeof useTransitionsStore.getState>['transitions'],
): string[][] {
  const visualSet = new Set(
    items
      .filter((item) => itemIds.includes(item.id) && item.type !== 'audio')
      .map((item) => item.id),
  )
  const visualIds = itemIds.filter((id) => visualSet.has(id))
  const { transitionsByClipId } = buildTransitionIndexes(transitions)
  return buildTransitionChains(visualIds, transitionsByClipId)
}

function templateGlyphPositions(templateId: MotionLayoutTemplateId): string[] {
  switch (templateId) {
    case 'grid-reveal':
      return [
        'left-[12%] top-[12%]',
        'right-[12%] top-[12%]',
        'left-[12%] bottom-[12%]',
        'right-[12%] bottom-[12%]',
      ]
    case 'center-stage':
      return [
        'left-[16%] top-[22%] scale-75 opacity-30',
        'left-[30%] top-[12%] scale-100',
        'right-[16%] top-[22%] scale-75 opacity-30',
      ]
    case 'focus-shift':
      return [
        'left-[8%] top-[12%] h-[76%] w-[58%]',
        'right-[8%] top-[12%] h-[22%] w-[22%]',
        'right-[8%] top-[39%] h-[22%] w-[22%]',
        'right-[8%] bottom-[12%] h-[22%] w-[22%]',
      ]
    case 'stack-slide':
      return [
        'left-[24%] top-[22%] rotate-[-4deg] opacity-40',
        'left-[28%] top-[18%] rotate-[3deg] opacity-70',
        'left-[32%] top-[14%]',
      ]
    case 'position-dance':
      return [
        'left-[10%] top-[26%] scale-75',
        'left-[36%] top-[12%]',
        'right-[10%] top-[28%] scale-75',
      ]
    case 'carousel-flow':
      return [
        '-left-[2%] top-[25%] scale-75 opacity-40',
        'left-[30%] top-[12%]',
        '-right-[2%] top-[25%] scale-75 opacity-40',
      ]
    case 'spotlight-zoom':
      return [
        'left-[8%] top-[10%] h-[32%] w-[34%] opacity-40',
        'right-[8%] top-[10%] h-[32%] w-[34%] opacity-40',
        'left-[22%] bottom-[8%] h-[66%] w-[56%]',
      ]
    case 'deck-peel':
      return [
        'left-[23%] top-[17%] rotate-[-6deg] opacity-35',
        'left-[29%] top-[14%] rotate-[4deg] opacity-65',
        'left-[34%] top-[11%] rotate-[-1deg]',
      ]
    case 'zoom-parallax':
      return [
        'left-[8%] top-[10%] h-[80%] w-[84%] opacity-25',
        'left-[16%] top-[16%] h-[68%] w-[70%]',
      ]
    case 'pop-grid':
      return [
        'left-[10%] top-[12%] scale-75',
        'left-[36%] top-[12%]',
        'right-[10%] top-[12%] scale-75',
        'left-[22%] bottom-[10%] scale-75',
        'right-[22%] bottom-[10%]',
      ]
    case 'ticker-loop':
      return [
        '-left-[4%] top-[18%] h-[28%] w-[34%] rotate-[-5deg]',
        'left-[34%] top-[18%] h-[28%] w-[34%] rotate-[-5deg]',
        'right-[1%] bottom-[16%] h-[28%] w-[34%] rotate-[-5deg]',
      ]
    case 'column-drift':
      return [
        'left-[8%] top-[8%] h-[40%] w-[24%]',
        'left-[38%] bottom-[8%] h-[40%] w-[24%]',
        'right-[8%] top-[20%] h-[40%] w-[24%]',
      ]
    case 'image-trail':
      return [
        'left-[6%] bottom-[6%] scale-50 rotate-[-12deg]',
        'left-[28%] top-[24%] scale-75 rotate-[-5deg]',
        'right-[22%] top-[12%] rotate-[8deg]',
      ]
    case 'poster-burst':
      return [
        'left-[22%] top-[18%] scale-50 rotate-[-12deg] opacity-40',
        'left-[28%] top-[14%] scale-75 rotate-[7deg] opacity-70',
        'left-[34%] top-[10%]',
      ]
    case 'diagonal-wipe':
      return ['left-[8%] top-[10%] h-[80%] w-[84%] skew-x-[-10deg]']
    case 'stripe-reveal':
      return [
        'left-[10%] top-[10%] h-[80%] w-[16%]',
        'left-[31%] top-[10%] h-[80%] w-[16%]',
        'right-[31%] top-[10%] h-[80%] w-[16%]',
        'right-[10%] top-[10%] h-[80%] w-[16%]',
      ]
    case 'split-reveal':
      return ['left-[8%] top-[10%] h-[80%] w-[42%]', 'right-[8%] top-[10%] h-[80%] w-[42%]']
    case 'showcase-stream':
      return [
        'left-[4%] top-[32%] scale-50 rotate-[-18deg] opacity-40',
        'left-[25%] top-[15%] scale-75 rotate-[-8deg]',
        'right-[25%] top-[15%] scale-75 rotate-[8deg]',
        'right-[4%] top-[32%] scale-50 rotate-[18deg] opacity-40',
      ]
    case 'card-totem':
      return [
        'left-[34%] -top-[8%] h-[38%] w-[32%] scale-75 opacity-35',
        'left-[34%] top-[30%] h-[38%] w-[32%]',
        'left-[34%] -bottom-[8%] h-[38%] w-[32%] scale-75 opacity-35',
      ]
    case 'film-strip':
      return [
        '-left-[5%] top-[26%] h-[48%] w-[32%] rotate-[-6deg] opacity-45',
        'left-[34%] top-[22%] h-[52%] w-[32%] rotate-[-2deg]',
        '-right-[5%] top-[26%] h-[48%] w-[32%] rotate-[4deg] opacity-45',
      ]
    case 'orbit-carousel':
      return [
        'left-[4%] top-[30%] scale-50 opacity-35',
        'left-[34%] top-[12%]',
        'right-[4%] top-[30%] scale-50 opacity-35',
      ]
    case 'flip-grid':
      return [
        'left-[10%] top-[12%]',
        'right-[10%] top-[12%] scale-x-[0.08]',
        'left-[10%] bottom-[12%] scale-x-[0.08]',
        'right-[10%] bottom-[12%]',
      ]
  }
}

const TEMPLATE_PREVIEW_WIDTH = 160
const TEMPLATE_PREVIEW_HEIGHT = 90
const TEMPLATE_PREVIEW_FPS = 30
const TEMPLATE_PREVIEW_SPEED = 1.6

function TemplateGlyph({
  templateId,
  settings,
  active = false,
}: {
  templateId: MotionLayoutTemplateId
  settings?: MotionLayoutSettings
  active?: boolean
}) {
  const reduceMotion = useReducedMotion()
  const [hovered, setHovered] = useState(false)
  const [inViewport, setInViewport] = useState(true)
  const rootRef = useRef<HTMLDivElement>(null)
  const elementByIdRef = useRef(new Map<string, HTMLSpanElement>())
  const template = MOTION_LAYOUT_TEMPLATE_BY_ID[templateId]
  const resolvedSettings = useMemo(
    () => settings ?? createDefaultMotionLayoutSettings(templateId),
    [settings, templateId],
  )
  const slotIds = useMemo(
    () =>
      Array.from(
        { length: Math.min(12, Math.max(template.minSlots, template.preferredSlots)) },
        (_, index) => `template-preview:${templateId}:${index}`,
      ),
    [template.minSlots, template.preferredSlots, templateId],
  )
  const plan = useMemo(
    () =>
      buildMotionLayoutPlan({
        templateId,
        slotIds,
        width: TEMPLATE_PREVIEW_WIDTH,
        height: TEMPLATE_PREVIEW_HEIGHT,
        fps: TEMPLATE_PREVIEW_FPS,
        settings: resolvedSettings,
      }),
    [resolvedSettings, slotIds, templateId],
  )
  const fallbackPositions = templateGlyphPositions(templateId)
  const applyFrame = useCallback(
    (frame: number) => {
      for (const [index, slot] of plan.slots.entries()) {
        const element = elementByIdRef.current.get(slot.itemId)
        if (!element) continue
        const resolved = resolveMotionLayoutSlot(slot, frame)
        const widthRatio = resolved.width / TEMPLATE_PREVIEW_WIDTH
        const heightRatio = resolved.height / TEMPLATE_PREVIEW_HEIGHT
        const previewSurface = element.parentElement
        const displayScale = previewSurface
          ? Math.min(
              previewSurface.clientWidth / TEMPLATE_PREVIEW_WIDTH,
              previewSurface.clientHeight / TEMPLATE_PREVIEW_HEIGHT,
            )
          : 1
        const rotateY =
          (index % 2 === 0 ? -1 : 1) *
          (template.category === 'perspective' ? resolvedSettings.perspective : 0) *
          42
        element.style.left = `${50 + (resolved.x / TEMPLATE_PREVIEW_WIDTH) * 100}%`
        element.style.top = `${50 + (resolved.y / TEMPLATE_PREVIEW_HEIGHT) * 100}%`
        element.style.width = `${widthRatio * 100}%`
        element.style.height = `${heightRatio * 100}%`
        element.style.transform = `translate(-50%, -50%) perspective(360px) rotate(${resolved.rotation}deg) rotateY(${rotateY}deg)`
        element.style.opacity = String(resolved.opacity)
        const radius = `${Number(Math.max(0, resolved.cornerRadius * displayScale).toFixed(2))}px`
        if (element.style.borderRadius !== radius) element.style.borderRadius = radius
        element.style.zIndex = String(
          Math.max(1, Math.round((1 - resolved.depthDim) * 20 + widthRatio * 10)),
        )
        const dim = element.firstElementChild as HTMLSpanElement | null
        if (dim) dim.style.opacity = String(resolved.depthDim)
      }
    },
    [plan.slots, resolvedSettings.perspective, template.category],
  )

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new IntersectionObserver(
      ([entry]) => setInViewport(entry?.isIntersecting ?? false),
      { threshold: 0.05 },
    )
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const restingFrame = Math.round(plan.durationInFrames * 0.32)
    applyFrame(restingFrame)
    if (reduceMotion || !inViewport || (!active && !hovered)) return

    let animationFrame = 0
    const startedAt = performance.now()
    const tick = (now: number) => {
      const elapsedFrames =
        ((now - startedAt) / 1000) * TEMPLATE_PREVIEW_FPS * TEMPLATE_PREVIEW_SPEED
      applyFrame((restingFrame + elapsedFrames) % plan.durationInFrames)
      animationFrame = requestAnimationFrame(tick)
    }
    animationFrame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationFrame)
  }, [active, applyFrame, hovered, inViewport, plan.durationInFrames, reduceMotion])

  return (
    <div
      ref={rootRef}
      className="relative aspect-video w-full overflow-hidden rounded-[4px] border border-border/60 bg-[#101014]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,.055),transparent_58%)]" />
      {slotIds.map((slotId, index) => (
        <span
          key={slotId}
          ref={(node) => {
            if (node) elementByIdRef.current.set(slotId, node)
            else elementByIdRef.current.delete(slotId)
          }}
          className={cn(
            'absolute h-[48%] w-[30%] overflow-hidden rounded-[4px] border border-white/15 shadow-sm will-change-[transform,opacity]',
            fallbackPositions[index],
          )}
          style={{
            background:
              index % 3 === 0
                ? 'linear-gradient(145deg, color-mix(in oklch, var(--primary) 82%, #202025), #29292f)'
                : index % 3 === 1
                  ? 'linear-gradient(145deg, #4a4a52, #202025 72%)'
                  : 'linear-gradient(145deg, #6a3927, #242329 76%)',
          }}
        >
          <span className="pointer-events-none absolute inset-0 bg-black opacity-0 will-change-[opacity]" />
          <span className="absolute inset-x-[10%] bottom-[12%] h-px bg-white/25" />
        </span>
      ))}
    </div>
  )
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  onChange: (value: number) => void
}) {
  return (
    <SliderInput
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      formatValue={format}
      liveChangeThrottleMs={32}
      onLiveChange={onChange}
      onChange={onChange}
    />
  )
}

function SettingsPanel({
  template,
  settings,
  onChange,
  onReset,
}: {
  template: MotionLayoutTemplateDefinition
  settings: MotionLayoutSettings
  onChange: <Key extends keyof MotionLayoutSettings>(
    key: Key,
    value: MotionLayoutSettings[Key],
  ) => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const has = (key: MotionLayoutParameterKey) => template.parameterKeys.includes(key)
  const percent = (value: number) => `${Math.round(value * 100)}%`

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t border-border/70">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/70"
        >
          <span>
            <span className="block text-xs font-medium">
              {t('timeline.motionLayout.workspace.customize')}
            </span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">
              {t(template.labelKey)}
            </span>
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-5 border-t border-border/60 px-4 py-4">
          {has('durationSeconds') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.duration')}
              value={settings.durationSeconds}
              min={2}
              max={30}
              step={0.25}
              format={(value) => `${value.toFixed(value % 1 === 0 ? 0 : 2)}s`}
              onChange={(value) => onChange('durationSeconds', value)}
            />
          ) : null}

          {has('backgroundColor') ? (
            <label className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">
                {t('timeline.motionLayout.parameters.background')}
              </span>
              <span className="flex items-center gap-2">
                <input
                  type="text"
                  value={settings.backgroundColor}
                  onChange={(event) => onChange('backgroundColor', event.currentTarget.value)}
                  className="h-7 w-20 rounded border border-input bg-background px-2 font-mono text-[11px] uppercase"
                  aria-label={t('timeline.motionLayout.parameters.background')}
                />
                <input
                  type="color"
                  value={settings.backgroundColor}
                  onChange={(event) => onChange('backgroundColor', event.currentTarget.value)}
                  className="h-7 w-7 cursor-pointer rounded border border-input bg-transparent p-0.5"
                  aria-label={t('timeline.motionLayout.parameters.pickColor')}
                />
              </span>
            </label>
          ) : null}

          {has('padding') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.padding')}
              value={settings.padding}
              min={0}
              max={0.2}
              step={0.005}
              format={percent}
              onChange={(value) => onChange('padding', value)}
            />
          ) : null}
          {has('gap') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.gap')}
              value={settings.gap}
              min={0}
              max={0.15}
              step={0.005}
              format={percent}
              onChange={(value) => onChange('gap', value)}
            />
          ) : null}
          {has('cornerRadius') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.cornerRadius')}
              value={settings.cornerRadius}
              min={0}
              max={0.16}
              step={0.005}
              format={percent}
              onChange={(value) => onChange('cornerRadius', value)}
            />
          ) : null}
          {has('railSize') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.railSize')}
              value={settings.railSize}
              min={0.18}
              max={0.4}
              step={0.01}
              format={percent}
              onChange={(value) => onChange('railSize', value)}
            />
          ) : null}
          {has('sideScale') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.sideScale')}
              value={settings.sideScale}
              min={0.55}
              max={0.95}
              step={0.01}
              format={(value) => value.toFixed(2)}
              onChange={(value) => onChange('sideScale', value)}
            />
          ) : null}
          {has('cardInset') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.cardInset')}
              value={settings.cardInset}
              min={0}
              max={0.2}
              step={0.005}
              format={percent}
              onChange={(value) => onChange('cardInset', value)}
            />
          ) : null}
          {has('spacing') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.spacing')}
              value={settings.spacing}
              min={-0.25}
              max={0.6}
              step={0.01}
              format={percent}
              onChange={(value) => onChange('spacing', value)}
            />
          ) : null}
          {has('backgroundDim') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.backgroundDim')}
              value={settings.backgroundDim}
              min={0}
              max={0.85}
              step={0.01}
              format={percent}
              onChange={(value) => onChange('backgroundDim', value)}
            />
          ) : null}
          {has('zoom') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.zoom')}
              value={settings.zoom}
              min={0.05}
              max={0.8}
              step={0.01}
              format={percent}
              onChange={(value) => onChange('zoom', value)}
            />
          ) : null}
          {has('tilt') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.tilt')}
              value={settings.tilt}
              min={-0.2}
              max={0.2}
              step={0.01}
              format={(value) => `${Math.round(value * 100)}°`}
              onChange={(value) => onChange('tilt', value)}
            />
          ) : null}
          {has('trailLength') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.trailLength')}
              value={settings.trailLength}
              min={0.2}
              max={1}
              step={0.01}
              format={percent}
              onChange={(value) => onChange('trailLength', value)}
            />
          ) : null}
          {has('staggerOverlap') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.staggerOverlap')}
              value={settings.staggerOverlap}
              min={0.1}
              max={0.9}
              step={0.01}
              format={percent}
              onChange={(value) => onChange('staggerOverlap', value)}
            />
          ) : null}
          {has('edgeAngle') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.edgeAngle')}
              value={settings.edgeAngle}
              min={-45}
              max={45}
              step={1}
              format={(value) => `${Math.round(value)}°`}
              onChange={(value) => onChange('edgeAngle', value)}
            />
          ) : null}
          {has('strips') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.strips')}
              value={settings.strips}
              min={2}
              max={16}
              step={1}
              format={(value) => String(Math.round(value))}
              onChange={(value) => onChange('strips', value)}
            />
          ) : null}
          {has('hold') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.hold')}
              value={settings.hold}
              min={0.1}
              max={0.8}
              step={0.01}
              format={percent}
              onChange={(value) => onChange('hold', value)}
            />
          ) : null}
          {has('perspective') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.perspective')}
              value={settings.perspective}
              min={0}
              max={0.6}
              step={0.01}
              format={percent}
              onChange={(value) => onChange('perspective', value)}
            />
          ) : null}
          {has('ringTilt') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.ringTilt')}
              value={settings.ringTilt}
              min={-0.8}
              max={0.8}
              step={0.01}
              format={(value) => `${Math.round(value * 100)}°`}
              onChange={(value) => onChange('ringTilt', value)}
            />
          ) : null}
          {has('ringOpening') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.ringOpening')}
              value={settings.ringOpening}
              min={0.2}
              max={1}
              step={0.01}
              format={percent}
              onChange={(value) => onChange('ringOpening', value)}
            />
          ) : null}
          {has('ringSize') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.ringSize')}
              value={settings.ringSize}
              min={0.35}
              max={1.1}
              step={0.01}
              format={percent}
              onChange={(value) => onChange('ringSize', value)}
            />
          ) : null}
          {has('cardSize') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.cardSize')}
              value={settings.cardSize}
              min={0.12}
              max={0.5}
              step={0.01}
              format={percent}
              onChange={(value) => onChange('cardSize', value)}
            />
          ) : null}
          {has('backFade') ? (
            <RangeControl
              label={t('timeline.motionLayout.parameters.backFade')}
              value={settings.backFade}
              min={0}
              max={1}
              step={0.01}
              format={percent}
              onChange={(value) => onChange('backFade', value)}
            />
          ) : null}

          {has('easing') ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t('timeline.motionLayout.parameters.easing')}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {EASING_OPTIONS.map((easing) => (
                  <button
                    key={easing}
                    type="button"
                    onClick={() => onChange('easing', easing)}
                    className={cn(
                      'h-8 rounded-md border px-2 text-xs transition-colors active:scale-[0.97]',
                      settings.easing === easing
                        ? 'border-primary/70 bg-primary/12 text-foreground'
                        : 'border-border/70 bg-background text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t(`timeline.motionLayout.easing.${easing}`)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {has('direction') ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t('timeline.motionLayout.parameters.direction')}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {(['horizontal', 'vertical'] as const).map((direction) => (
                  <button
                    key={direction}
                    type="button"
                    onClick={() => onChange('direction', direction)}
                    className={cn(
                      'h-8 rounded-md border px-2 text-xs transition-colors active:scale-[0.97]',
                      settings.direction === direction
                        ? 'border-primary/70 bg-primary/12 text-foreground'
                        : 'border-border/70 bg-background text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t(`timeline.motionLayout.direction.${direction}`)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full gap-2"
            onClick={onReset}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('timeline.motionLayout.resetSettings')}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function MotionSourceThumbnail({ url, lazy = false }: { url?: string; lazy?: boolean }) {
  return (
    <span className="relative flex h-9 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-black/60">
      <Film className="h-4 w-4 text-zinc-500" />
      {url ? (
        <img
          key={url}
          src={url}
          alt=""
          width={56}
          height={36}
          loading={lazy ? 'lazy' : undefined}
          className="absolute inset-0 h-full w-full object-cover"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      ) : null}
    </span>
  )
}

function MediaSlotsPanel({
  template,
  chains,
  sources,
  posterUrls,
  pickerSlotIndex,
  selectedSlotIndex,
  onPickerSlotChange,
  onSelectedSlotChange,
  onAssign,
  onRemove,
  onMove,
}: {
  template: MotionLayoutTemplateDefinition
  chains: string[][]
  sources: MotionSourceEntry[]
  posterUrls: Map<string, string>
  pickerSlotIndex: number | null
  selectedSlotIndex: number | null
  onPickerSlotChange: (index: number | null) => void
  onSelectedSlotChange: (index: number | null) => void
  onAssign: (index: number, sourceId: string) => void
  onRemove: (index: number) => void
  onMove: (from: number, to: number) => void
}) {
  const { t } = useTranslation()
  const sourceById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources])
  const usedSourceIds = useMemo(() => new Set(chains.flat()), [chains])
  const slotCount = Math.min(template.maxSlots, Math.max(template.preferredSlots, chains.length))
  const assignDroppedSource = useCallback(
    (event: DragEvent, index: number) => {
      event.preventDefault()
      let sourceId = event.dataTransfer.getData('application/x-freecut-motion-source')
      if (!sourceId) {
        try {
          const data = JSON.parse(event.dataTransfer.getData('application/json')) as {
            mediaId?: string
          }
          sourceId = sources.find((source) => source.mediaId === data.mediaId)?.id ?? ''
        } catch {
          sourceId = ''
        }
      }
      if (!sourceId || (usedSourceIds.has(sourceId) && chains[index]?.[0] !== sourceId)) {
        toast.error(t('timeline.motionLayout.workspace.dropUnavailable'))
        return
      }
      onAssign(index, sourceId)
    },
    [chains, onAssign, sources, t, usedSourceIds],
  )

  return (
    <section className="border-t border-border/70">
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3">
        <div>
          <h2 className="text-xs font-medium">{t('timeline.motionLayout.workspace.mediaSlots')}</h2>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {t('timeline.motionLayout.workspace.slotsRequired', {
              count: chains.length,
              required: template.minSlots,
            })}
          </p>
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-1 text-[10px] font-medium tabular-nums',
            chains.length >= template.minSlots
              ? 'bg-emerald-500/12 text-emerald-400'
              : 'bg-primary/12 text-primary',
          )}
        >
          {chains.length}/{template.minSlots}
        </span>
      </div>

      <div className="space-y-1.5 px-3 pb-3">
        {Array.from({ length: slotCount }, (_, index) => {
          const chain = chains[index]
          const source = chain ? sourceById.get(chain[0]!) : undefined
          const thumbnailUrl = posterUrls.get(source?.mediaId ?? '') ?? source?.thumbnailUrl
          return (
            <div key={`slot:${index}`} className="group flex items-center gap-1">
              <Popover
                open={pickerSlotIndex === index}
                onOpenChange={(open) => onPickerSlotChange(open ? index : null)}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    onDragOver={(event) => {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'copy'
                    }}
                    onDrop={(event) => assignDroppedSource(event, index)}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
                      chain
                        ? 'border-border/80 bg-background hover:bg-muted/50'
                        : 'border-dashed border-border/80 bg-muted/20 text-muted-foreground hover:border-primary/50 hover:bg-primary/5 hover:text-foreground',
                      selectedSlotIndex === index && 'border-primary/70 bg-primary/8',
                    )}
                  >
                    {thumbnailUrl || chain ? (
                      <MotionSourceThumbnail url={thumbnailUrl} />
                    ) : (
                      <span className="flex h-9 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-black/60">
                        <ImagePlus className="h-4 w-4" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] font-medium text-muted-foreground">
                        {t('timeline.motionLayout.workspace.slotLabel', { count: index + 1 })}
                      </span>
                      <span className="block truncate text-xs font-medium">
                        {source?.label ?? t('timeline.motionLayout.workspace.chooseClip')}
                      </span>
                    </span>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="left"
                  sideOffset={8}
                  collisionPadding={8}
                  className="w-80 overflow-hidden p-0 duration-150 [animation-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:animate-none"
                >
                  <div className="border-b border-border/70 px-3 py-2.5">
                    <p className="text-xs font-medium">
                      {t('timeline.motionLayout.workspace.chooseForSlot', { count: index + 1 })}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {t('timeline.motionLayout.workspace.projectClips')}
                    </p>
                  </div>
                  <ScrollArea className="h-72 [&_[data-radix-scroll-area-viewport]>div]:!block [&_[data-radix-scroll-area-viewport]>div]:!w-full [&_[data-radix-scroll-area-viewport]>div]:!min-w-0">
                    <div className="w-full min-w-0 max-w-full space-y-1 overflow-hidden p-2 pr-4">
                      {sources.map((candidate) => {
                        const usedElsewhere =
                          usedSourceIds.has(candidate.id) && chain?.[0] !== candidate.id
                        const candidateThumbnail =
                          posterUrls.get(candidate.mediaId ?? '') ?? candidate.thumbnailUrl
                        return (
                          <button
                            key={candidate.id}
                            type="button"
                            draggable={!usedElsewhere}
                            onDragStart={(event) => {
                              event.dataTransfer.setData(
                                'application/x-freecut-motion-source',
                                candidate.id,
                              )
                              event.dataTransfer.effectAllowed = 'copy'
                            }}
                            disabled={usedElsewhere}
                            onClick={() => onAssign(index, candidate.id)}
                            className="flex w-full min-w-0 max-w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <MotionSourceThumbnail url={candidateThumbnail} lazy />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium">
                                {candidate.label}
                              </span>
                              <span className="block text-[10px] capitalize text-muted-foreground">
                                {usedElsewhere
                                  ? t('timeline.motionLayout.workspace.alreadyUsed')
                                  : candidate.type}
                              </span>
                            </span>
                            {chain?.[0] === candidate.id ? <Check className="h-3.5 w-3.5" /> : null}
                          </button>
                        )
                      })}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>

              {chain ? (
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => onSelectedSlotChange(index)}
                    className={cn(
                      'rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
                      selectedSlotIndex === index && 'bg-primary/10 text-primary',
                    )}
                    aria-label={`Adjust ${source?.label ?? `Slot ${index + 1}`}`}
                    aria-pressed={selectedSlotIndex === index}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => onMove(index, index - 1)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-20"
                    aria-label={t('timeline.motionLayout.moveEarlier')}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={index === chains.length - 1}
                    onClick={() => onMove(index, index + 1)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-20"
                    aria-label={t('timeline.motionLayout.moveLater')}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(index)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/70"
                    aria-label={t('timeline.motionLayout.workspace.removeSlot')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function SlotAdjustmentPanel({
  slotIndex,
  source,
  adjustment,
  layoutDurationSeconds,
  onChange,
  onReset,
}: {
  slotIndex: number
  source: MotionSourceEntry
  adjustment: MotionLayoutSlotAdjustment
  layoutDurationSeconds: number
  onChange: (adjustment: MotionLayoutSlotAdjustment) => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  const safeLayoutDurationSeconds =
    Number.isFinite(layoutDurationSeconds) && layoutDurationSeconds > 0 ? layoutDurationSeconds : 1
  const durationSeconds = source.durationInFrames / Math.max(1, source.fps)
  const windowRatio = Math.min(1, safeLayoutDurationSeconds / Math.max(0.01, durationSeconds))
  const formatRangeTime = (ratio: number) => `${(durationSeconds * ratio).toFixed(1)}s`
  const update = (patch: Partial<MotionLayoutSlotAdjustment>) =>
    onChange({ ...adjustment, ...patch })
  const updateSourceStart = (percent: number) => {
    const sourceStart = Math.max(0, Math.min(1 - windowRatio, percent / 100))
    update({ sourceStart, sourceEnd: sourceStart + windowRatio })
  }
  const updateSourceEnd = (percent: number) => {
    const sourceEnd = Math.max(windowRatio, Math.min(1, percent / 100))
    update({ sourceStart: sourceEnd - windowRatio, sourceEnd })
  }

  return (
    <section className="border-t border-border/70 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
            {t('timeline.motionLayout.adjust.title')}
          </p>
          <p className="mt-1 truncate text-xs font-medium">
            {slotIndex + 1}. {source.label}
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
          aria-label={t('timeline.motionLayout.adjust.reset')}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
        {t('timeline.motionLayout.adjust.dragHint')}
      </p>

      <div className="mt-3 space-y-2">
        <SliderInput
          label={t('timeline.motionLayout.adjust.zoom')}
          value={adjustment.scale * 100}
          min={100}
          max={300}
          step={1}
          unit="%"
          liveChangeThrottleMs={32}
          onLiveChange={(value) => update({ scale: value / 100 })}
          onChange={(value) => update({ scale: value / 100 })}
        />
        <div className="grid grid-cols-2 gap-2">
          <SliderInput
            label="X"
            value={adjustment.offsetX * 100}
            min={-100}
            max={100}
            step={1}
            unit="%"
            liveChangeThrottleMs={32}
            onLiveChange={(value) => update({ offsetX: value / 100 })}
            onChange={(value) => update({ offsetX: value / 100 })}
          />
          <SliderInput
            label="Y"
            value={adjustment.offsetY * 100}
            min={-100}
            max={100}
            step={1}
            unit="%"
            liveChangeThrottleMs={32}
            onLiveChange={(value) => update({ offsetY: value / 100 })}
            onChange={(value) => update({ offsetY: value / 100 })}
          />
        </div>
      </div>

      <div className="mt-4 border-t border-border/60 pt-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-medium text-muted-foreground">
            {t('timeline.motionLayout.adjust.sourceRange')}
          </p>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {formatRangeTime(adjustment.sourceStart)} – {formatRangeTime(adjustment.sourceEnd)}
          </span>
        </div>
        <p className="mt-1 text-[9px] text-muted-foreground">
          {safeLayoutDurationSeconds.toFixed(1)}s · {t('timeline.motionLayout.adjust.normalSpeed')}
        </p>
        <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="absolute inset-y-0 rounded-full bg-primary"
            style={{
              left: `${adjustment.sourceStart * 100}%`,
              right: `${(1 - adjustment.sourceEnd) * 100}%`,
            }}
          />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <SliderInput
            label={t('timeline.motionLayout.adjust.in')}
            value={adjustment.sourceStart * 100}
            min={0}
            max={windowRatio >= 0.999 ? 100 : (1 - windowRatio) * 100}
            step={1}
            disabled={windowRatio >= 0.999}
            formatValue={(value) => formatRangeTime(value / 100)}
            liveChangeThrottleMs={32}
            onLiveChange={updateSourceStart}
            onChange={updateSourceStart}
          />
          <SliderInput
            label={t('timeline.motionLayout.adjust.out')}
            value={adjustment.sourceEnd * 100}
            min={windowRatio >= 0.999 ? 0 : windowRatio * 100}
            max={100}
            step={1}
            disabled={windowRatio >= 0.999}
            formatValue={(value) => formatRangeTime(value / 100)}
            liveChangeThrottleMs={32}
            onLiveChange={updateSourceEnd}
            onChange={updateSourceEnd}
          />
        </div>
      </div>
    </section>
  )
}

function MotionLayoutDialogBody({
  itemIds,
  compositionId,
  close,
  workspaceMode = false,
}: {
  itemIds: string[]
  compositionId: string | null
  close: () => void
  workspaceMode?: boolean
}) {
  const { t } = useTranslation()
  const items = useItemsStore((state) => state.items)
  const transitions = useTransitionsStore((state) => state.transitions)
  const timelineFps = useTimelineSettingsStore((state) => state.fps)
  const projectWidth = useProjectStore(
    (state) => state.currentProject?.metadata.width ?? DEFAULT_PROJECT_WIDTH,
  )
  const projectHeight = useProjectStore(
    (state) => state.currentProject?.metadata.height ?? DEFAULT_PROJECT_HEIGHT,
  )
  const editingComposition = useCompositionsStore((state) =>
    compositionId ? state.compositionById[compositionId] : undefined,
  )
  const compositionById = useCompositionsStore((state) => state.compositionById)
  const editingMotionLayout = editingComposition?.motionLayout
  const fps = editingComposition?.fps ?? timelineFps
  const initialFrameAspect =
    editingMotionLayout?.frameAspect ??
    closestMotionLayoutFrameAspect(
      editingComposition?.width ?? projectWidth,
      editingComposition?.height ?? projectHeight,
    )
  const initialChains = useMemo(
    () =>
      editingMotionLayout
        ? (
            editingMotionLayout.slotOrder ??
            editingMotionLayout.slots.map((slot) => slot.compositionId)
          ).map((compositionId) => [compositionId])
        : buildChainOrder(itemIds, items, transitions),
    [editingMotionLayout, itemIds, items, transitions],
  )
  const [chainOrder, setChainOrder] = useState<string[][]>(() => initialChains)
  const [selectedTemplateId, setSelectedTemplateId] = useState<MotionLayoutTemplateId>(
    () => editingMotionLayout?.templateId ?? 'grid-reveal',
  )
  const [settings, setSettings] = useState<MotionLayoutSettings>(() =>
    editingMotionLayout
      ? { ...editingMotionLayout.settings }
      : createDefaultMotionLayoutSettings('grid-reveal'),
  )
  const [frameAspect, setFrameAspect] = useState<MotionLayoutFrameAspect>(initialFrameAspect)
  const { width, height } = resolveMotionLayoutFrameSize(projectWidth, projectHeight, frameAspect)
  const [leftPanel, setLeftPanel] = useState<'templates' | 'layouts'>('templates')
  const [pickerSlotIndex, setPickerSlotIndex] = useState<number | null>(null)
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null)
  const initialSlotAdjustments = useMemo(
    () =>
      Object.fromEntries(
        (editingMotionLayout?.slots ?? []).flatMap((slot) =>
          slot.adjustment
            ? [[slot.compositionId, { ...DEFAULT_SLOT_ADJUSTMENT, ...slot.adjustment }] as const]
            : [],
        ),
      ) as Record<string, MotionLayoutSlotAdjustment>,
    [editingMotionLayout?.slots],
  )
  const [slotAdjustments, setSlotAdjustments] = useState<
    Record<string, MotionLayoutSlotAdjustment>
  >(() => initialSlotAdjustments)
  const [pendingNavigation, setPendingNavigation] = useState<'exit' | 'new' | 'layout' | null>(null)
  const [pendingCompositionId, setPendingCompositionId] = useState<string | null>(null)
  const initialDraftSignature = useMemo(
    () =>
      JSON.stringify({
        chainOrder: initialChains,
        templateId: editingMotionLayout?.templateId ?? 'grid-reveal',
        frameAspect: initialFrameAspect,
        settings: editingMotionLayout?.settings ?? createDefaultMotionLayoutSettings('grid-reveal'),
        slotAdjustments: initialSlotAdjustments,
      }),
    [editingMotionLayout, initialChains, initialFrameAspect, initialSlotAdjustments],
  )
  const [savedDraftSignature, setSavedDraftSignature] = useState(initialDraftSignature)
  const template = MOTION_LAYOUT_TEMPLATE_BY_ID[selectedTemplateId]
  const visibleChains = chainOrder.slice(0, template.maxSlots)
  const motionLayouts = useMemo(
    () => Object.values(compositionById).filter((composition) => composition.motionLayout),
    [compositionById],
  )
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const editingSlotByCompositionId = useMemo(
    () =>
      new Map(editingMotionLayout?.slots.map((slot) => [slot.compositionId, slot] as const) ?? []),
    [editingMotionLayout],
  )
  const resolveSlotItem = useCallback(
    (id: string) =>
      itemById.get(id) ??
      compositionById[id]?.items.find((item) => item.type !== 'audio') ??
      compositionById[id]?.items[0],
    [compositionById, itemById],
  )
  const resolveSlotLabel = useCallback(
    (id: string) =>
      editingSlotByCompositionId.get(id)?.label ?? resolveSlotItem(id)?.label ?? id.slice(0, 6),
    [editingSlotByCompositionId, resolveSlotItem],
  )
  const resolvePreviewVideoItem = useCallback(
    (id: string): Extract<TimelineItem, { type: 'video' }> | undefined => {
      let item = resolveSlotItem(id)
      const visitedCompositionIds = new Set<string>()
      for (let depth = 0; item && depth < 6; depth += 1) {
        if (item.type === 'video') return item
        if (item.type !== 'composition' || visitedCompositionIds.has(item.compositionId)) {
          return undefined
        }
        visitedCompositionIds.add(item.compositionId)
        const composition = compositionById[item.compositionId]
        item =
          composition?.items.find((candidate) => candidate.type === 'video') ??
          composition?.items.find((candidate) => candidate.type !== 'audio')
      }
      return undefined
    },
    [compositionById, resolveSlotItem],
  )
  const sourceEntries = useMemo(() => {
    const entries = new Map<string, MotionSourceEntry>()
    for (const slot of editingMotionLayout?.slots ?? []) {
      const item =
        compositionById[slot.compositionId]?.items.find(
          (candidate) => candidate.type !== 'audio',
        ) ?? compositionById[slot.compositionId]?.items[0]
      const previewVideo = resolvePreviewVideoItem(slot.compositionId)
      entries.set(slot.compositionId, {
        id: slot.compositionId,
        label: slot.label,
        mediaId: getItemMediaId(previewVideo ?? item),
        thumbnailUrl:
          previewVideo?.thumbnailUrl ??
          (item && 'thumbnailUrl' in item && typeof item.thumbnailUrl === 'string'
            ? item.thumbnailUrl
            : undefined),
        previewSrc: previewVideo?.src,
        type: item?.type ?? 'video',
        durationInFrames:
          compositionById[slot.compositionId]?.durationInFrames ?? item?.durationInFrames ?? fps,
        fps: compositionById[slot.compositionId]?.fps ?? fps,
      })
    }
    for (const item of items) {
      if (
        item.type === 'audio' ||
        (editingComposition !== undefined && item.compositionId === editingComposition.id)
      ) {
        continue
      }
      const previewVideo = resolvePreviewVideoItem(item.id)
      entries.set(item.id, {
        id: item.id,
        label: item.label,
        mediaId: getItemMediaId(previewVideo ?? item),
        thumbnailUrl:
          'thumbnailUrl' in item && typeof item.thumbnailUrl === 'string'
            ? item.thumbnailUrl
            : undefined,
        previewSrc: previewVideo?.src,
        type: item.type,
        durationInFrames: item.sourceDuration ?? item.durationInFrames,
        fps: item.sourceFps ?? fps,
      })
    }
    return [...entries.values()]
  }, [
    compositionById,
    editingComposition,
    editingMotionLayout?.slots,
    fps,
    items,
    resolvePreviewVideoItem,
  ])
  const sourceMediaIds = useMemo(
    () => sourceEntries.flatMap((source) => (source.mediaId ? [source.mediaId] : [])),
    [sourceEntries],
  )
  const posterUrls = useMediaPosterUrls(sourceMediaIds)
  const selectedPreviewSourceId =
    selectedSlotIndex === null ? undefined : visibleChains[selectedSlotIndex]?.[0]
  const selectedPreviewSource = selectedPreviewSourceId
    ? sourceEntries.find((source) => source.id === selectedPreviewSourceId)
    : undefined
  const selectedPreviewUrl = useMediaPreviewUrl(
    selectedPreviewSource?.mediaId,
    selectedPreviewSource?.previewSrc,
  )
  const assignSourceToSlot = useCallback((slotIndex: number, sourceId: string) => {
    setChainOrder((current) => {
      const existingIndex = current.findIndex((chain) => chain.includes(sourceId))
      if (existingIndex >= 0 && existingIndex !== slotIndex) return current
      const next = [...current]
      if (slotIndex < next.length) next[slotIndex] = [sourceId]
      else if (slotIndex === next.length) next.push([sourceId])
      return next
    })
    setPickerSlotIndex(null)
    setSelectedSlotIndex(slotIndex)
  }, [])
  const removeSlot = useCallback((slotIndex: number) => {
    setChainOrder((current) => current.filter((_, index) => index !== slotIndex))
    setPickerSlotIndex(null)
    setSelectedSlotIndex((current) => {
      if (current === null) return null
      if (current === slotIndex) return null
      return current > slotIndex ? current - 1 : current
    })
  }, [])
  const previewSlotCount = Math.min(
    template.maxSlots,
    visibleChains.length === 0
      ? template.preferredSlots
      : visibleChains.length < template.minSlots
        ? template.minSlots
        : visibleChains.length,
  )
  const previewSlots: MotionLayoutPreviewSlot[] = useMemo(
    () =>
      Array.from({ length: previewSlotCount }, (_, index) => {
        const chain = visibleChains[index]
        const first = chain ? resolveSlotItem(chain[0]!) : undefined
        const previewVideo = chain ? resolvePreviewVideoItem(chain[0]!) : undefined
        const sourceEntry = chain
          ? sourceEntries.find((source) => source.id === chain[0])
          : undefined
        const labels = chain?.map(resolveSlotLabel) ?? []
        return {
          id: `slot:${index}`,
          label:
            labels.join(' → ') ||
            t('timeline.motionLayout.workspace.slotPlaceholder', { count: index + 1 }),
          type: first?.type ?? 'video',
          thumbnailUrl:
            posterUrls.get(sourceEntry?.mediaId ?? getItemMediaId(first) ?? '') ??
            sourceEntry?.thumbnailUrl ??
            (first && 'thumbnailUrl' in first && typeof first.thumbnailUrl === 'string'
              ? first.thumbnailUrl
              : undefined),
          previewSrc:
            selectedSlotIndex === index
              ? (selectedPreviewUrl ?? sourceEntry?.previewSrc ?? previewVideo?.src)
              : undefined,
          sourceDurationSeconds: sourceEntry
            ? sourceEntry.durationInFrames / Math.max(1, sourceEntry.fps)
            : undefined,
          placeholder: !chain,
          adjustment:
            chain && sourceEntry
              ? resolveSlotAdjustmentWindow(
                  sourceEntry,
                  settings.durationSeconds,
                  slotAdjustments[chain[0]!],
                )
              : DEFAULT_SLOT_ADJUSTMENT,
        }
      }),
    [
      posterUrls,
      previewSlotCount,
      resolveSlotItem,
      resolveSlotLabel,
      resolvePreviewVideoItem,
      selectedPreviewUrl,
      selectedSlotIndex,
      sourceEntries,
      settings.durationSeconds,
      slotAdjustments,
      t,
      visibleChains,
    ],
  )
  const previewPlan = useMemo(
    () =>
      buildMotionLayoutPlan({
        templateId: selectedTemplateId,
        slotIds: previewSlots.map((slot) => slot.id),
        width,
        height,
        fps,
        settings,
      }),
    [fps, height, previewSlots, selectedTemplateId, settings, width],
  )
  const canApply = visibleChains.length >= template.minSlots
  const effectiveSlotAdjustments = Object.fromEntries(
    visibleChains.flatMap((chain) => {
      const sourceId = chain[0]
      const source = sourceEntries.find((entry) => entry.id === sourceId)
      if (!sourceId || !source) return []
      return [
        [
          sourceId,
          resolveSlotAdjustmentWindow(source, settings.durationSeconds, slotAdjustments[sourceId]),
        ],
      ]
    }),
  ) as Record<string, MotionLayoutSlotAdjustment>
  const currentDraftSignature = JSON.stringify({
    chainOrder,
    templateId: selectedTemplateId,
    frameAspect,
    settings,
    slotAdjustments,
  })
  const isDirty = currentDraftSignature !== savedDraftSignature

  const updateSetting = useCallback(
    <Key extends keyof MotionLayoutSettings>(key: Key, value: MotionLayoutSettings[Key]) => {
      setSettings((current) => ({ ...current, [key]: value }))
    },
    [],
  )

  const selectTemplate = useCallback(
    (next: MotionLayoutTemplateDefinition) => {
      if (chainOrder.length > next.maxSlots) {
        toast.error(
          t('timeline.motionLayout.workspace.templateNeedsFewer', {
            count: chainOrder.length - next.maxSlots,
          }),
        )
        return
      }
      setSelectedTemplateId(next.id)
      setSettings((current) => ({
        ...next.defaults,
        backgroundColor: current.backgroundColor,
      }))
      setPickerSlotIndex(null)
    },
    [chainOrder.length, t],
  )

  const moveSlot = useCallback((from: number, to: number) => {
    setChainOrder((current) => {
      if (from === to || to < 0 || to >= current.length) return current
      const next = [...current]
      const [moved] = next.splice(from, 1)
      if (!moved) return current
      next.splice(to, 0, moved)
      return next
    })
    setSelectedSlotIndex((current) => {
      if (current === null) return null
      if (current === from) return to
      if (from < to && current > from && current <= to) return current - 1
      if (to < from && current >= to && current < from) return current + 1
      return current
    })
  }, [])

  const handleApply = useCallback(() => {
    if (!canApply) return
    const generatedName = t('timeline.motionLayout.generatedName', {
      template: t(template.labelKey),
    })
    const result = compositionId
      ? updateMotionLayout({
          compositionId,
          slotCompositionIds: chainOrder.flat(),
          templateId: selectedTemplateId,
          settings,
          frameAspect,
          frameWidth: width,
          frameHeight: height,
          slotAdjustments: effectiveSlotAdjustments,
          name: generatedName,
        })
      : applyMotionLayout({
          itemIds: visibleChains.flat(),
          chainOrder: visibleChains,
          templateId: selectedTemplateId,
          settings,
          frameAspect,
          frameWidth: width,
          frameHeight: height,
          slotAdjustments: effectiveSlotAdjustments,
          name: generatedName,
        })
    if (!result) {
      toast.error(t('timeline.motionLayout.applyFailed'))
      return
    }
    setSavedDraftSignature(currentDraftSignature)
    toast.success(t('timeline.motionLayout.applied', { template: t(template.labelKey) }))
    if (workspaceMode) {
      useMotionLayoutDialogStore.getState().openExisting(result.compositionId)
      const saved = useCompositionsStore.getState().getComposition(result.compositionId)
      const savedOrder = saved?.motionLayout?.slotOrder
      if (savedOrder) setChainOrder(savedOrder.map((sourceId) => [sourceId]))
      if (saved?.motionLayout) {
        setSlotAdjustments(
          Object.fromEntries(
            saved.motionLayout.slots.map((slot) => [
              slot.compositionId,
              { ...DEFAULT_SLOT_ADJUSTMENT, ...slot.adjustment },
            ]),
          ),
        )
      }
      return
    }
    close()
  }, [
    canApply,
    chainOrder,
    close,
    compositionId,
    currentDraftSignature,
    frameAspect,
    height,
    selectedTemplateId,
    settings,
    effectiveSlotAdjustments,
    t,
    template,
    visibleChains,
    width,
    workspaceMode,
  ])

  const startNewLayout = useCallback(() => {
    useMotionLayoutDialogStore.getState().open([])
  }, [])

  const requestNavigation = useCallback(
    (target: 'exit' | 'new') => {
      if (isDirty) {
        setPendingNavigation(target)
        return
      }
      if (target === 'exit') close()
      else startNewLayout()
    },
    [close, isDirty, startNewLayout],
  )

  const openExistingLayout = useCallback(
    (nextCompositionId: string) => {
      if (nextCompositionId === compositionId) return
      if (isDirty) {
        setPendingCompositionId(nextCompositionId)
        setPendingNavigation('layout')
        return
      }
      useMotionLayoutDialogStore.getState().openExisting(nextCompositionId)
    },
    [compositionId, isDirty],
  )

  const selectedSourceId =
    selectedSlotIndex === null ? undefined : visibleChains[selectedSlotIndex]?.[0]
  const selectedSource = selectedSourceId
    ? sourceEntries.find((source) => source.id === selectedSourceId)
    : undefined
  const selectedAdjustment =
    selectedSourceId && selectedSource
      ? resolveSlotAdjustmentWindow(
          selectedSource,
          settings.durationSeconds,
          slotAdjustments[selectedSourceId],
        )
      : DEFAULT_SLOT_ADJUSTMENT
  const updateSelectedAdjustment = (adjustment: MotionLayoutSlotAdjustment) => {
    if (!selectedSourceId) return
    setSlotAdjustments((current) => ({ ...current, [selectedSourceId]: adjustment }))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!workspaceMode ? (
        <header className="panel-header flex items-center justify-between gap-4 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Layers3 className="h-4 w-4 text-primary" />
              {workspaceMode ? (
                <h1 className="text-sm font-semibold">
                  {editingComposition?.name ?? t('timeline.motionLayout.workspace.newLayout')}
                </h1>
              ) : (
                <DialogTitle>{t('timeline.motionLayout.title')}</DialogTitle>
              )}
            </div>
            {workspaceMode ? (
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {t(template.descriptionKey)}
              </p>
            ) : (
              <DialogDescription className="mt-1">{t(template.descriptionKey)}</DialogDescription>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isDirty ? (
              <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                {t('timeline.motionLayout.workspace.unsaved')}
              </span>
            ) : null}
          </div>
        </header>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_340px]">
        <aside className="panel-bg flex min-h-0 flex-col border-r border-border px-3 py-3">
          {workspaceMode ? (
            <div className="mb-2 flex min-w-0 items-center gap-2 px-1">
              <Layers3 className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                {editingComposition?.name ?? t('timeline.motionLayout.workspace.newLayout')}
              </span>
              {isDirty ? (
                <span className="shrink-0 text-[9px] font-medium text-amber-400">
                  {t('timeline.motionLayout.workspace.unsaved')}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="mb-4 grid grid-cols-2 gap-0.5 rounded-md border border-border/60 bg-background/45 p-0.5">
            <button
              type="button"
              onClick={() => setLeftPanel('templates')}
              className={cn(
                'flex h-7 items-center justify-center gap-1.5 rounded text-xs font-medium',
                leftPanel === 'templates'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground',
              )}
            >
              <LayoutTemplate className="h-3.5 w-3.5" />
              {t('timeline.motionLayout.workspace.templates')}
            </button>
            <button
              type="button"
              onClick={() => setLeftPanel('layouts')}
              className={cn(
                'flex h-7 items-center justify-center gap-1.5 rounded text-xs font-medium',
                leftPanel === 'layouts'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground',
              )}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {t('timeline.motionLayout.workspace.myLayouts')}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {leftPanel === 'templates' ? (
              CATEGORY_ORDER.map((category) => {
                const templates = MOTION_LAYOUT_TEMPLATES.filter(
                  (entry) => entry.category === category,
                )
                return (
                  <section key={category} className="mb-5 last:mb-0">
                    <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      {t(`timeline.motionLayout.categories.${category}`)}
                    </h3>
                    <div className="space-y-2">
                      {templates.map((entry) => {
                        const selected = entry.id === selectedTemplateId
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => selectTemplate(entry)}
                            className={cn(
                              'group w-full rounded-md border p-1.5 text-left transition-[background-color,border-color,transform] duration-150 active:scale-[0.99]',
                              selected
                                ? 'border-primary/60 bg-secondary/40'
                                : 'border-border/60 bg-secondary/15 hover:border-border hover:bg-secondary/35',
                            )}
                          >
                            <TemplateGlyph templateId={entry.id} active={selected} />
                            <span className="mt-2 flex items-center justify-between gap-2">
                              <span className="text-xs font-medium">{t(entry.labelKey)}</span>
                              <span className="rounded border border-border/60 bg-background/50 px-1.5 py-0.5 text-[9px] tabular-nums text-muted-foreground">
                                {t('timeline.motionLayout.workspace.bestWith', {
                                  count: entry.preferredSlots,
                                })}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                              {t(entry.descriptionKey)}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </section>
                )
              })
            ) : (
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mb-2 w-full gap-2"
                  onClick={() => requestNavigation('new')}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('timeline.motionLayout.workspace.newLayout')}
                </Button>
                {motionLayouts.map((composition) => {
                  const selected = composition.id === compositionId
                  const layoutTemplate = composition.motionLayout
                    ? MOTION_LAYOUT_TEMPLATE_BY_ID[composition.motionLayout.templateId]
                    : null
                  return (
                    <button
                      key={composition.id}
                      type="button"
                      onClick={() => openExistingLayout(composition.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
                        selected
                          ? 'border-primary/60 bg-secondary/40'
                          : 'border-border/60 bg-secondary/15 hover:bg-secondary/35',
                      )}
                    >
                      <span className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-black/70">
                        {layoutTemplate && composition.motionLayout ? (
                          <TemplateGlyph
                            templateId={layoutTemplate.id}
                            settings={composition.motionLayout.settings}
                            active={selected}
                          />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">
                          {composition.name}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">
                          {layoutTemplate ? t(layoutTemplate.labelKey) : ''} ·{' '}
                          {(composition.durationInFrames / Math.max(1, composition.fps)).toFixed(1)}
                          s
                        </span>
                      </span>
                    </button>
                  )
                })}
                {motionLayouts.length === 0 ? (
                  <div className="px-3 py-10 text-center">
                    <FolderOpen className="mx-auto h-5 w-5 text-muted-foreground" />
                    <p className="mt-2 text-xs font-medium">
                      {t('timeline.motionLayout.workspace.noLayouts')}
                    </p>
                    <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                      {t('timeline.motionLayout.workspace.noLayoutsHint')}
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </aside>

        <main className="timeline-bg flex min-h-0 flex-col px-5 py-4">
          <MotionLayoutPreview
            plan={previewPlan}
            slots={previewSlots}
            width={width}
            height={height}
            fps={fps}
            backgroundColor={settings.backgroundColor}
            perspectiveAmount={template.category === 'perspective' ? settings.perspective : 0}
            selectedSlotId={selectedSlotIndex === null ? null : `slot:${selectedSlotIndex}`}
            onSelectSlot={(slotId) => {
              const index = Number(slotId.split(':')[1])
              if (Number.isFinite(index) && visibleChains[index]) setSelectedSlotIndex(index)
            }}
            onAdjustSlot={(slotId, adjustment) => {
              const index = Number(slotId.split(':')[1])
              const sourceId = Number.isFinite(index) ? visibleChains[index]?.[0] : undefined
              if (!sourceId) return
              setSelectedSlotIndex(index)
              setSlotAdjustments((current) => ({ ...current, [sourceId]: adjustment }))
            }}
          />

          <div className="mt-3 flex items-center justify-between gap-4 border-t border-white/8 pt-3 text-[10px] text-zinc-500">
            <span>
              {visibleChains.length === 0
                ? t('timeline.motionLayout.workspace.previewHint')
                : t('timeline.motionLayout.workspace.previewReady', {
                    count: visibleChains.length,
                  })}
            </span>
            <span className="font-mono tabular-nums">{settings.durationSeconds.toFixed(1)}s</span>
          </div>
        </main>

        <aside className="panel-bg flex min-h-0 flex-col border-l border-border">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <section className="px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {t('timeline.motionLayout.workspace.format')}
              </p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-xs font-medium">
                  {width} × {height}
                </span>
                <span className="rounded border border-border/60 bg-secondary/30 px-2 py-1 text-[10px] text-muted-foreground">
                  {t(template.labelKey)}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-5 gap-1">
                {MOTION_LAYOUT_FRAME_ASPECTS.map((aspect) => {
                  const [aspectWidth = 1, aspectHeight = 1] = aspect.split(':').map(Number)
                  const landscape = aspectWidth >= aspectHeight
                  const ratio = aspectWidth / aspectHeight
                  const iconWidth = landscape ? 24 : 18 * ratio
                  const iconHeight = landscape ? 24 / ratio : 18
                  const selected = frameAspect === aspect
                  return (
                    <button
                      key={aspect}
                      type="button"
                      aria-label={`${aspect} frame`}
                      aria-pressed={selected}
                      onClick={() => setFrameAspect(aspect)}
                      className={cn(
                        'flex h-11 flex-col items-center justify-center gap-1 rounded border text-[9px] transition-colors',
                        selected
                          ? 'border-primary/60 bg-primary/10 text-primary'
                          : 'border-border/60 bg-secondary/20 text-muted-foreground hover:bg-secondary/45 hover:text-foreground',
                      )}
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 28 20"
                        className="h-5 w-7 overflow-visible"
                      >
                        <rect
                          x={(28 - iconWidth) / 2}
                          y={(20 - iconHeight) / 2}
                          width={iconWidth}
                          height={iconHeight}
                          rx={Math.min(1.75, iconHeight * 0.12)}
                          fill={selected ? 'currentColor' : 'none'}
                          fillOpacity={selected ? 0.12 : 0}
                          stroke="currentColor"
                          strokeWidth="1"
                          vectorEffect="non-scaling-stroke"
                        />
                      </svg>
                      <span className="tabular-nums">{aspect}</span>
                    </button>
                  )
                })}
              </div>
            </section>
            <MediaSlotsPanel
              template={template}
              chains={visibleChains}
              sources={sourceEntries}
              posterUrls={posterUrls}
              pickerSlotIndex={pickerSlotIndex}
              selectedSlotIndex={selectedSlotIndex}
              onPickerSlotChange={setPickerSlotIndex}
              onSelectedSlotChange={setSelectedSlotIndex}
              onAssign={assignSourceToSlot}
              onRemove={removeSlot}
              onMove={moveSlot}
            />
            {selectedSlotIndex !== null && selectedSource ? (
              <SlotAdjustmentPanel
                slotIndex={selectedSlotIndex}
                source={selectedSource}
                adjustment={selectedAdjustment}
                layoutDurationSeconds={settings.durationSeconds}
                onChange={updateSelectedAdjustment}
                onReset={() =>
                  updateSelectedAdjustment(
                    resolveSlotAdjustmentWindow(selectedSource, settings.durationSeconds),
                  )
                }
              />
            ) : null}
            <SettingsPanel
              template={template}
              settings={settings}
              onChange={updateSetting}
              onReset={() => setSettings(createDefaultMotionLayoutSettings(selectedTemplateId))}
            />
          </div>
          {workspaceMode ? (
            <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[10px]',
                  canApply ? 'text-muted-foreground' : 'text-amber-400',
                )}
              >
                {canApply
                  ? t('timeline.motionLayout.workspace.readyToCreate')
                  : t('timeline.motionLayout.workspace.addMoreSlots', {
                      count: template.minSlots - visibleChains.length,
                    })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={() => requestNavigation('exit')}
              >
                {t('timeline.motionLayout.workspace.backToEdit')}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 px-3"
                disabled={!canApply}
                onClick={handleApply}
              >
                {compositionId
                  ? t('timeline.motionLayout.workspace.updateMotionClip')
                  : t('timeline.motionLayout.workspace.createMotionClip')}
              </Button>
            </div>
          ) : null}
        </aside>
      </div>

      {!workspaceMode ? (
        <footer className="panel-header flex items-center justify-between gap-4 border-t border-border px-5 py-3">
          <div>
            <p className="text-xs font-medium">
              {canApply
                ? t('timeline.motionLayout.workspace.readyToCreate')
                : t('timeline.motionLayout.workspace.addMoreSlots', {
                    count: template.minSlots - visibleChains.length,
                  })}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {t('timeline.motionLayout.compoundHint')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => requestNavigation('exit')}>
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={!canApply} onClick={handleApply}>
              {compositionId
                ? t('timeline.motionLayout.workspace.updateMotionClip')
                : t('timeline.motionLayout.workspace.createMotionClip')}
            </Button>
          </div>
        </footer>
      ) : null}

      <AlertDialog
        open={pendingNavigation !== null}
        onOpenChange={(open) => !open && setPendingNavigation(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('timeline.motionLayout.workspace.discardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('timeline.motionLayout.workspace.discardDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = pendingNavigation
                setPendingNavigation(null)
                if (target === 'exit') close()
                else if (target === 'new') startNewLayout()
                else if (target === 'layout' && pendingCompositionId) {
                  useMotionLayoutDialogStore.getState().openExisting(pendingCompositionId)
                }
              }}
            >
              {t('timeline.motionLayout.workspace.discardChanges')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// Lazy-loaded through the editor timeline contract; the static export audit
// cannot follow that indirection.
// fallow-ignore-next-line unused-export
export function MotionLayoutWorkspace() {
  const itemIds = useMotionLayoutDialogStore((state) => state.itemIds)
  const compositionId = useMotionLayoutDialogStore((state) => state.compositionId)

  const closeWorkspace = useCallback(() => {
    useMotionLayoutDialogStore.getState().close()
    useEditorStore.getState().setWorkspace('edit')
  }, [])

  return (
    <div className="min-w-0 flex-1 overflow-hidden bg-background">
      <MotionLayoutDialogBody
        key={compositionId ?? `new:${itemIds.join(':')}`}
        itemIds={itemIds}
        compositionId={compositionId}
        close={closeWorkspace}
        workspaceMode
      />
    </div>
  )
}

// Lazy-loaded through the editor timeline contract; the static export audit
// cannot follow that indirection.
// fallow-ignore-next-line unused-export
export default function MotionLayoutDialog() {
  const isOpen = useMotionLayoutDialogStore((state) => state.isOpen)
  const itemIds = useMotionLayoutDialogStore((state) => state.itemIds)
  const compositionId = useMotionLayoutDialogStore((state) => state.compositionId)
  const close = useMotionLayoutDialogStore((state) => state.close)

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent
        hideCloseButton
        className="h-[min(780px,calc(100vh-2rem))] max-w-[1180px] gap-0 overflow-hidden p-0"
      >
        {isOpen ? (
          <MotionLayoutDialogBody itemIds={itemIds} compositionId={compositionId} close={close} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
