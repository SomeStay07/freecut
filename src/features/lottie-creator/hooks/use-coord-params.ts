/**
 * Derive gizmo `CoordinateParams` from the live-Lottie canvas box.
 *
 * The overlay is positioned exactly over the canvas box, so `containerRect` and
 * `playerSize` are the same element — screen↔canvas math reduces to a single
 * fit scale (`zoom: -1`). Recomputes on resize/scroll so the gizmo tracks layout.
 */
import { useLayoutEffect, useMemo, useState, type RefObject } from 'react'
import type { CoordinateParams } from '../deps/gizmo'

export function useCoordParams(
  ref: RefObject<HTMLElement | null>,
  width: number,
  height: number,
): CoordinateParams | null {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setRect(el.getBoundingClientRect())
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [ref])

  return useMemo(
    () =>
      rect
        ? {
            containerRect: rect,
            playerSize: { width: rect.width, height: rect.height },
            projectSize: { width, height },
            zoom: -1,
          }
        : null,
    [rect, width, height],
  )
}
