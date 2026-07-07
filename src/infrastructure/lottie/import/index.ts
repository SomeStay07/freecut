/**
 * Lottie → FreeCut items importer (decomposer).
 *
 * Pure, dependency-free reconstruction of editable timeline items from a Lottie
 * ("bodymovin") JSON document — the inverse of `../export`. See
 * `decompose-lottie-document.ts` for the entry point.
 */
export { decomposeLottieDocument } from './decompose-lottie-document'
export type { DecomposedLottieScene, DecomposeOptions } from './decompose-lottie-document'
export type { LottieImportWarning, LottieImportWarningCode } from './warnings'
