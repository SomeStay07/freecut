/**
 * Lottie authoring — an in-editor "enter-to-edit" surface. A Lottie is a
 * `type:'lottie'` clip on the timeline backed by a `kind:'lottie'`
 * sub-composition; entering it swaps the editor to the rich creator surface
 * (`LottieCompositionWorkspace`). There is no standalone route — Lotties are
 * created and edited entirely within the editor.
 */
export { LottieCompositionWorkspace } from './components/lottie-composition-workspace'
