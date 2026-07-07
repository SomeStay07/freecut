/**
 * Cross-feature contract for the in-editor Lottie composition flow. All
 * `@/features/*` imports live here (per the deps contract boundary rule); the
 * sibling `lottie-composition.ts` re-exports from this file.
 */
export { LottieCompositionWorkspace } from '@/features/lottie-creator'
export { useCompositionNavigationStore } from '@/features/timeline/stores/composition-navigation-store'
export { createLottieComposition } from '@/features/timeline/stores/actions/composition-actions'
