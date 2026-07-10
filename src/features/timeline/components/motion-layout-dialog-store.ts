import { create } from 'zustand'

interface MotionLayoutDialogState {
  isOpen: boolean
  itemIds: string[]
  compositionId: string | null
  open: (itemIds: string[]) => void
  openExisting: (compositionId: string) => void
  close: () => void
}

export const useMotionLayoutDialogStore = create<MotionLayoutDialogState>((set) => ({
  isOpen: false,
  itemIds: [],
  compositionId: null,
  open: (itemIds) => set({ isOpen: true, itemIds, compositionId: null }),
  openExisting: (compositionId) => set({ isOpen: true, itemIds: [], compositionId }),
  close: () => set({ isOpen: false, itemIds: [], compositionId: null }),
}))
