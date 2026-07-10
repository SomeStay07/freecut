export type CompositionAssetRole = 'compound' | 'motion-layout' | 'motion-slot'

export type CompositionLibraryVisibility = 'visible' | 'managed'

/** Ownership metadata for compositions whose lifecycle is managed by another asset. */
export interface CompositionManagedBy {
  kind: 'motion-layout-slot'
  ownerCompositionId: string
  slotId: string
}
