/**
 * In-editor Lottie workspace — rendered by the editor when the active
 * composition is `kind:'lottie'`. It authors the composition's shape/text
 * layers directly (the composition IS the storage) through the shared
 * `LottieCreatorSurface`, the same rich UI as the standalone `/lottie` route.
 *
 * The only in-editor-specific piece is the "Done" control: it regenerates the
 * parent timeline's wrapper clip from the authored layers, then exits the
 * composition so the animation plays in place.
 */
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildLottieDocument } from '@/infrastructure/lottie/export'
import { CREATOR_FONT } from '../utils/creator-font'
import { useCompositionCreatorController } from '../hooks/use-composition-creator-controller'
import { LottieCreatorSurface } from './lottie-creator-surface'
import {
  useCompositionNavigationStore,
  useCompositionsStore,
  useTimelineStore,
  KeyframeGraphPanel,
} from '../deps/timeline'

/** Stable placeholder so the controller hook can run before a composition exists. */
const EMPTY_COMPOSITION = {
  id: '',
  name: '',
  items: [],
  tracks: [],
  transitions: [],
  keyframes: [],
  fps: 30,
  width: 512,
  height: 512,
  durationInFrames: 90,
  kind: 'lottie' as const,
}

export function LottieCompositionWorkspace() {
  const compId = useCompositionNavigationStore((s) => s.activeCompositionId)
  const comp = useCompositionsStore((s) => (compId ? s.compositionById[compId] : undefined))

  // Hooks must run unconditionally — a null-ish composition still needs a
  // controller so the surface can render an empty state.
  const controller = useCompositionCreatorController(comp ?? EMPTY_COMPOSITION)

  if (!comp) return null

  const handleExit = () => {
    // Exit first — this saves the live items/tracks/keyframes stores back onto
    // the composition and restores the parent timeline to the live stores. Only
    // after that has happened is `comp` (captured above, now stale) safe to
    // re-fetch fresh from the compositions store.
    useCompositionNavigationStore.getState().exitComposition()

    const fresh = useCompositionsStore.getState().getComposition(comp.id)
    if (!fresh) return

    const orderByTrackId = new Map(fresh.tracks.map((t) => [t.id, t.order]))
    const sortedItems = [...fresh.items].sort(
      (a, b) => (orderByTrackId.get(a.trackId) ?? 0) - (orderByTrackId.get(b.trackId) ?? 0),
    )
    const keyframes = Object.fromEntries(fresh.keyframes.map((k) => [k.itemId, k]))
    const { document } = buildLottieDocument(sortedItems, {
      fps: fresh.fps,
      width: fresh.width,
      height: fresh.height,
      durationInFrames: fresh.durationInFrames,
      name: fresh.name,
      fontName: CREATOR_FONT,
      keyframes,
    })
    const src = URL.createObjectURL(
      new Blob([JSON.stringify(document)], { type: 'application/json' }),
    )

    const wrapper = useTimelineStore
      .getState()
      .items.find((i) => i.type === 'lottie' && i.compositionId === comp.id)
    if (wrapper) {
      useTimelineStore.getState().updateItem(wrapper.id, {
        src,
        totalFrames: fresh.durationInFrames,
        frameRate: fresh.fps,
      })
    }
  }

  return (
    <LottieCreatorSurface
      controller={controller}
      renderLeading={() => (
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={handleExit}>
          <ArrowLeft className="h-4 w-4" />
          Done
        </Button>
      )}
      renderDock={() => (
        <KeyframeGraphPanel
          isOpen
          splitView
          showCloseButton={false}
          onClose={() => {}}
          canvasOverride={{ width: comp.width, height: comp.height, fps: comp.fps }}
        />
      )}
    />
  )
}
