import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { MotionLayoutPlan } from '../utils/motion-layout'
import { resolveMotionLayoutSlot } from '../utils/motion-layout'

export interface MotionLayoutPreviewSlot {
  id: string
  label: string
  type: string
  thumbnailUrl?: string
  placeholder?: boolean
}

const SLOT_COLORS: Record<string, string> = {
  video: '#2563eb',
  image: '#16a34a',
  text: '#d97706',
  shape: '#9333ea',
  composition: '#0891b2',
  adjustment: '#7c3aed',
}

function setInlineStyle(element: HTMLElement, property: string, value: string): void {
  if (element.style.getPropertyValue(property) === value) return
  element.style.setProperty(property, value)
}

function compactNumber(value: number, precision = 4): string {
  return String(Number(value.toFixed(precision)))
}

export const MotionLayoutPreview = memo(function MotionLayoutPreview({
  plan,
  slots,
  width,
  height,
  fps,
  backgroundColor,
  perspectiveAmount = 0,
  selectedSlotId,
  onSelectSlot,
}: {
  plan: MotionLayoutPlan
  slots: MotionLayoutPreviewSlot[]
  width: number
  height: number
  fps: number
  backgroundColor: string
  perspectiveAmount?: number
  selectedSlotId?: string | null
  onSelectSlot?: (slotId: string) => void
}) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const [playing, setPlaying] = useState(true)
  const elementByIdRef = useRef(new Map<string, HTMLButtonElement>())
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const scrubberRef = useRef<HTMLInputElement>(null)
  const timeLabelRef = useRef<HTMLSpanElement>(null)
  const playheadRef = useRef(0)
  const slotPlanById = useMemo(
    () => new Map(plan.slots.map((slot) => [slot.itemId, slot])),
    [plan.slots],
  )

  useEffect(() => {
    if (reduceMotion) setPlaying(false)
  }, [reduceMotion])

  useEffect(() => {
    const viewport = viewportRef.current
    const canvas = canvasRef.current
    if (!viewport || !canvas) return

    const resize = () => {
      const availableWidth = viewport.clientWidth
      const availableHeight = viewport.clientHeight
      if (availableWidth < 1 || availableHeight < 1) return
      const frameAspect = width / Math.max(1, height)
      const availableAspect = availableWidth / availableHeight
      if (frameAspect >= availableAspect) {
        canvas.style.width = `${availableWidth}px`
        canvas.style.height = `${availableWidth / frameAspect}px`
      } else {
        canvas.style.width = `${availableHeight * frameAspect}px`
        canvas.style.height = `${availableHeight}px`
      }
    }

    const observer = new ResizeObserver(resize)
    observer.observe(viewport)
    resize()
    return () => observer.disconnect()
  }, [height, width])

  const applyFrame = useCallback(
    (frame: number) => {
      const safeFrame = Math.max(0, Math.min(plan.durationInFrames - 1, frame))
      playheadRef.current = safeFrame
      const frameValue = String(safeFrame)
      if (scrubberRef.current && scrubberRef.current.value !== frameValue) {
        scrubberRef.current.value = frameValue
      }
      if (timeLabelRef.current) {
        const seconds = safeFrame / Math.max(1, plan.durationInFrames)
        const nextLabel = `${(seconds * 100).toFixed(0)}%`
        if (timeLabelRef.current.textContent !== nextLabel) {
          timeLabelRef.current.textContent = nextLabel
        }
      }

      for (const [index, slot] of slots.entries()) {
        const element = elementByIdRef.current.get(slot.id)
        const slotPlan = slotPlanById.get(slot.id)
        if (!element || !slotPlan) continue
        const resolved = resolveMotionLayoutSlot(slotPlan, safeFrame)
        const x = (resolved.x / width) * 100
        const y = (resolved.y / height) * 100
        const widthRatio = resolved.width / width
        const heightRatio = resolved.height / height
        const canvas = canvasRef.current
        const displayScale = canvas
          ? Math.min(canvas.clientWidth / width, canvas.clientHeight / height)
          : 1
        const rotateY = (index % 2 === 0 ? -1 : 1) * perspectiveAmount * 55
        setInlineStyle(element, 'left', `${compactNumber(50 + x)}%`)
        setInlineStyle(element, 'top', `${compactNumber(50 + y)}%`)
        setInlineStyle(element, 'width', `${compactNumber(widthRatio * 100)}%`)
        setInlineStyle(element, 'height', `${compactNumber(heightRatio * 100)}%`)
        setInlineStyle(
          element,
          'transform',
          `translate(-50%, -50%) perspective(900px) rotate(${compactNumber(resolved.rotation, 3)}deg) rotateY(${compactNumber(rotateY, 3)}deg)`,
        )
        setInlineStyle(element, 'opacity', compactNumber(resolved.opacity))
        setInlineStyle(element, '--motion-depth-dim', compactNumber(resolved.depthDim))
        setInlineStyle(
          element,
          'border-radius',
          `${compactNumber(Math.max(0, resolved.cornerRadius * displayScale), 2)}px`,
        )
        setInlineStyle(
          element,
          'z-index',
          String(
            Math.max(
              1,
              Math.round((1 - resolved.depthDim) * 20 + resolved.opacity * 2 + widthRatio * 10),
            ),
          ),
        )
      }
    },
    [height, perspectiveAmount, plan.durationInFrames, slotPlanById, slots, width],
  )

  useEffect(() => {
    applyFrame(playheadRef.current)
  }, [applyFrame])

  useEffect(() => {
    if (!playing || reduceMotion) return
    let animationFrame = 0
    const startFrame = playheadRef.current
    const startedAt = performance.now()
    const framesPerMs = fps / 1000

    const tick = (now: number) => {
      const elapsedFrames = (now - startedAt) * framesPerMs
      applyFrame((startFrame + elapsedFrames) % plan.durationInFrames)
      animationFrame = requestAnimationFrame(tick)
    }
    animationFrame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationFrame)
  }, [applyFrame, fps, plan.durationInFrames, playing, reduceMotion])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div ref={viewportRef} className="flex min-h-0 flex-1 items-center justify-center">
        <div
          ref={canvasRef}
          className="relative overflow-hidden rounded-[4px] border border-border/70 bg-black shadow-[0_8px_30px_rgba(0,0,0,.35)]"
          style={{ aspectRatio: `${width} / ${height}`, backgroundColor }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,0.08),transparent_45%)]" />
          {slots.map((slot, index) => (
            <button
              key={slot.id}
              type="button"
              aria-label={slot.label}
              onClick={() => onSelectSlot?.(slot.id)}
              ref={(node) => {
                if (node) elementByIdRef.current.set(slot.id, node)
                else elementByIdRef.current.delete(slot.id)
              }}
              className={`absolute origin-center overflow-hidden border bg-cover bg-center text-left shadow-lg outline-none transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-primary/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black will-change-[left,top,width,height,transform,opacity] ${
                selectedSlotId === slot.id
                  ? 'border-primary ring-2 ring-primary/70 ring-inset'
                  : slot.placeholder
                    ? 'border-dashed border-white/25'
                    : 'border-white/15'
              }`}
              style={{
                backgroundColor: slot.placeholder
                  ? 'rgba(39, 39, 42, 0.76)'
                  : (SLOT_COLORS[slot.type] ?? '#475569'),
                backgroundImage: slot.placeholder
                  ? 'linear-gradient(135deg, rgba(255,255,255,.10), rgba(255,255,255,.015))'
                  : slot.thumbnailUrl
                    ? `linear-gradient(180deg, transparent 45%, rgba(0,0,0,.72)), url("${slot.thumbnailUrl}")`
                    : 'linear-gradient(135deg, rgba(255,255,255,.16), rgba(255,255,255,.02))',
              }}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-black opacity-[var(--motion-depth-dim,0)] will-change-[opacity]"
              />
              <span className="absolute bottom-3 left-3 right-3 z-10 truncate text-sm font-medium text-white drop-shadow">
                {slot.placeholder ? '+ ' : `${index + 1}. `}
                {slot.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-8 w-8 active:scale-[0.97]"
          onClick={() => setPlaying((current) => !current)}
          aria-label={
            playing
              ? t('timeline.motionLayout.preview.pause')
              : t('timeline.motionLayout.preview.play')
          }
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 active:scale-[0.97]"
          onClick={() => {
            applyFrame(0)
            if (!reduceMotion) setPlaying(true)
          }}
          aria-label={t('timeline.motionLayout.preview.restart')}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <input
          ref={scrubberRef}
          type="range"
          min={0}
          max={Math.max(1, plan.durationInFrames - 1)}
          step={1}
          defaultValue={0}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
          aria-label={t('timeline.motionLayout.preview.scrubber')}
          onChange={(event) => {
            setPlaying(false)
            applyFrame(Number(event.currentTarget.value))
          }}
        />
        <span
          ref={timeLabelRef}
          className="w-10 text-right text-xs tabular-nums text-muted-foreground"
        >
          0%
        </span>
      </div>
    </div>
  )
})
