/**
 * In-memory clipboard for creator layers (copy/paste). Holds a deep snapshot of
 * the copied shape/text items plus their keyframes, so paste re-instantiates
 * fresh layers even after the originals change or are deleted. A tiny store (not
 * a module variable) so the context menu / shortcuts can reactively enable
 * "Paste" when something has been copied.
 */
import { create } from 'zustand'
import type { ShapeItem, TextItem } from '@/types/timeline'
import type { PropertyKeyframes } from '@/types/keyframe'

export interface ClipboardLayer {
  item: ShapeItem | TextItem
  properties: PropertyKeyframes[]
}

interface CreatorClipboardState {
  layers: ClipboardLayer[]
  setLayers: (layers: ClipboardLayer[]) => void
}

export const useCreatorClipboardStore = create<CreatorClipboardState>((set) => ({
  layers: [],
  setLayers: (layers) => set({ layers }),
}))
