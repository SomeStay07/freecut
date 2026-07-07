/**
 * Template picker for the Lottie Creator. Each card renders a live, looping
 * dotLottie preview built from the template's native shapes (via the same
 * `buildLottieDocument` core), so what you see is exactly what you'll edit.
 * Picking one replaces the current document.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import type { ItemKeyframes } from '@/types/keyframe'
import { buildLottieDocument } from '@/infrastructure/lottie/export'
import { LOTTIE_TEMPLATES, type CreatorTemplate } from '../utils/templates'
import type { CreatorLayer } from '@/types/lottie-creation'
import { LottieLivePreview } from './lottie-live-preview'

export interface TemplateDocument {
  width: number
  height: number
  durationInFrames: number
  layers: CreatorLayer[]
}

const CHECKER_STYLE = {
  backgroundColor: '#2a2a2a',
  backgroundImage:
    'linear-gradient(45deg, #3a3a3a 25%, transparent 25%), linear-gradient(-45deg, #3a3a3a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3a3a3a 75%), linear-gradient(-45deg, transparent 75%, #3a3a3a 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
}

function TemplateCard({
  template,
  onPick,
}: {
  template: CreatorTemplate
  onPick: (doc: TemplateDocument) => void
}) {
  // Build once so the thumbnail and the committed document share ids.
  const layers = useMemo(() => template.build(), [template])
  const data = useMemo(() => {
    const keyframes: Record<string, ItemKeyframes> = {}
    for (const l of layers) {
      if (l.properties.length > 0)
        keyframes[l.item.id] = { itemId: l.item.id, properties: l.properties }
    }
    const { document } = buildLottieDocument(
      layers.map((l) => l.item),
      {
        fps: 30,
        width: template.width,
        height: template.height,
        durationInFrames: template.durationInFrames,
        keyframes,
      },
    )
    return JSON.stringify(document)
  }, [layers, template])

  const [frame, setFrame] = useState(0)
  useEffect(() => {
    let raf = 0
    let prev = performance.now()
    const tick = (now: number) => {
      const dt = (now - prev) / 1000
      prev = now
      setFrame((f) => (f + dt * 30) % template.durationInFrames)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [template.durationInFrames])

  return (
    <button
      onClick={() =>
        onPick({
          width: template.width,
          height: template.height,
          durationInFrames: template.durationInFrames,
          layers,
        })
      }
      className="group flex flex-col overflow-hidden rounded-lg border border-border transition-colors hover:border-primary"
    >
      <div className="relative aspect-square w-full" style={CHECKER_STYLE}>
        {layers.length > 0 ? (
          <LottieLivePreview data={data} frame={frame} className="h-full w-full" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            Empty
          </div>
        )}
      </div>
      <div className="px-2 py-1.5 text-left text-xs font-medium">{template.name}</div>
    </button>
  )
}

export function TemplateGallery({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (doc: TemplateDocument) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Start from a template</DialogTitle>
          <DialogDescription>
            Templates are made of editable shapes — pick one and keep tweaking.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {LOTTIE_TEMPLATES.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onPick={(doc) => {
                onPick(doc)
                onOpenChange(false)
              }}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
