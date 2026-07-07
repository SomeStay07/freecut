/**
 * Orchestrates a "Export as Lottie" action: reads the current timeline snapshot,
 * orders items by visual z-order, runs the pure `buildLottieDocument` exporter,
 * and downloads the resulting `.json`. Keeps store access + DOM download here so
 * the exporter core (`@/infrastructure/lottie/export`) stays pure and testable.
 */
import type { TimelineItem } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import {
  getExportableSequence,
  type ExportableSequence,
} from '@/features/export/deps/timeline-compositions'
import { buildLottieDocument, type LottieExportWarning } from '@/infrastructure/lottie/export'
import { createLogger, createOperationId } from '@/shared/logging/logger'

const log = createLogger('LottieExport')

export interface LottieExportOutcome {
  /** Number of shape layers that made it into the document. */
  shapeCount: number
  /** Total items considered (including skipped non-shape items). */
  totalConsidered: number
  warnings: LottieExportWarning[]
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'freecut-export'
}

/**
 * Flatten items into top-to-bottom z-order: non-group tracks sorted by `order`
 * ascending (lower order = visually higher), items pulled per track. The first
 * item becomes the topmost Lottie layer, matching `buildLottieDocument`.
 */
function orderItemsByZ(seq: ExportableSequence): TimelineItem[] {
  const tracks = seq.tracks.filter((track) => !track.isGroup).sort((a, b) => a.order - b.order)
  const itemsByTrack = new Map<string, TimelineItem[]>()
  for (const item of seq.items) {
    const existing = itemsByTrack.get(item.trackId)
    if (existing) existing.push(item)
    else itemsByTrack.set(item.trackId, [item])
  }
  const ordered: TimelineItem[] = []
  for (const track of tracks) {
    const trackItems = itemsByTrack.get(track.id)
    if (trackItems) ordered.push(...trackItems)
  }
  return ordered
}

function downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/**
 * Build and download a Lottie document for a sequence (null = Main timeline).
 * Returns the outcome so the caller can surface a summary/warnings toast.
 */
export function exportTimelineAsLottie(sequenceId: string | null = null): LottieExportOutcome {
  const event = log.startEvent('export-lottie', createOperationId())
  try {
    const seq = getExportableSequence(sequenceId)
    const items = orderItemsByZ(seq)

    const keyframes: Record<string, ItemKeyframes> = {}
    for (const itemKeyframes of seq.keyframes) keyframes[itemKeyframes.itemId] = itemKeyframes

    const { document: doc, warnings } = buildLottieDocument(items, {
      fps: seq.fps,
      width: seq.width,
      height: seq.height,
      name: seq.name,
      durationInFrames: seq.durationFrames || undefined,
      keyframes,
    })

    const shapeCount = doc.layers.length
    if (shapeCount > 0) {
      downloadJson(JSON.stringify(doc), `${sanitizeFilename(seq.name)}.json`)
    }

    event.success({
      sequenceId: sequenceId ?? 'main',
      shapeCount,
      totalConsidered: items.length,
      warnings: warnings.length,
    })
    return { shapeCount, totalConsidered: items.length, warnings }
  } catch (error) {
    event.failure(error)
    throw error
  }
}
