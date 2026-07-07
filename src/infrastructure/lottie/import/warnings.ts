/**
 * Warnings surfaced while decomposing a Lottie document into editable items.
 * The importer supports the vector subset FreeCut itself emits (shape/text
 * layers, precomp folders, transform animation); anything outside that is
 * skipped or approximated and reported here so the UI can tell the user what
 * didn't survive the round-trip.
 */
export type LottieImportWarningCode =
  | 'unsupported-layer-type'
  | 'unsupported-shape'
  | 'gradient-approximated'
  | 'missing-asset'
  | 'scale-approximated'
  | 'animated-transform-approximated'
  | 'animated-color-frozen'
  | 'precomp-transform-dropped'
  | 'empty-document'

export interface LottieImportWarning {
  code: LottieImportWarningCode
  message: string
  /** Layer name, when the warning is about a specific layer. */
  layerName?: string
}
