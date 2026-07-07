/**
 * Adapter exports for the in-editor Lottie composition flow.
 * Editor modules import the Lottie workspace + composition entry from here.
 */
export { LottieCompositionWorkspace } from '@/features/lottie-creator'
export { useCompositionNavigationStore } from '@/features/timeline/stores/composition-navigation-store'
export { createLottieComposition } from '@/features/timeline/stores/actions/composition-actions'
