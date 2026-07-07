/**
 * FreeCut → Lottie exporter (Phase 1: shapes).
 *
 * Pure, dependency-free conversion of timeline items into a Lottie ("bodymovin")
 * JSON document — the inverse of the import pipeline in
 * `src/infrastructure/lottie/`. See `build-lottie-document.ts` for the entry
 * point.
 */
export { buildLottieDocument } from './build-lottie-document'
export type {
  LottieExportOptions,
  LottieExportResult,
  LottieExportWarning,
  LottieExportWarningCode,
} from './build-lottie-document'
export type { LottieDocument } from './lottie-schema'
export { parseCssColorToRgba01 } from './color'
export { svgPathToLottieBezier } from './svg-path'
