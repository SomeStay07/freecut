/**
 * The live Lottie preview: renders the *actual* Lottie (via dotLottie/thorvg)
 * built from the creator's authoring state, seeked to the current playhead.
 * This is the point of the dedicated creator — WYSIWYG against real Lottie
 * output, not the app's own canvas renderer.
 *
 * Structural edits change `data` (a rebuilt document) and reload the renderer
 * (debounced, since dotLottie has no in-place data update); scrubbing only
 * calls the synchronous `renderFrame`.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LottieRenderer } from '@/infrastructure/lottie/lottie-frame-provider'

interface LottieLivePreviewProps {
  /** Serialized Lottie document (JSON string). */
  data: string
  /** Frame to display (composition frames). */
  frame: number
  /** Bump to force a renderer rebuild (e.g. once a font finishes registering). */
  reloadToken?: unknown
  className?: string
}

export function LottieLivePreview({ data, frame, reloadToken, className }: LottieLivePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<LottieRenderer | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [debouncedData, setDebouncedData] = useState(data)

  // Always hold the latest frame so a reload can paint it immediately, even
  // when paused (the frame effect below won't re-fire if `frame` is unchanged).
  const frameRef = useRef(frame)
  useLayoutEffect(() => {
    frameRef.current = frame
  }, [frame])

  const seek = (renderer: LottieRenderer, f: number) => {
    renderer.renderFrame(Math.max(0, Math.min(f, renderer.totalFrames - 1)))
  }

  // Coalesce rapid structural edits (slider drags) into one reload.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedData(data), 90)
    return () => window.clearTimeout(id)
  }, [data])

  // (Re)create the renderer whenever the document changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    setLoaded(false)
    let cancelled = false
    const renderer = new LottieRenderer({ canvas, data: debouncedData, autoResize: true })
    rendererRef.current = renderer
    void renderer.ready.then(() => {
      if (cancelled || !renderer.isLoaded) return
      // Paint the current frame right away — a reload while paused would
      // otherwise leave the canvas on the freshly-loaded frame 0.
      seek(renderer, frameRef.current)
      setLoaded(true)
    })
    return () => {
      cancelled = true
      renderer.destroy()
      rendererRef.current = null
    }
  }, [debouncedData, reloadToken])

  // Seek on playhead change (scrub/playback).
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || !loaded) return
    seek(renderer, frame)
  }, [frame, loaded])

  return <canvas ref={canvasRef} className={className} />
}
