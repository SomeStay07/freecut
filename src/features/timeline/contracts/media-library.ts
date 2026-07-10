/**
 * Timeline contract consumed by media-library feature adapters.
 */

export {
  getLibraryVisibleCompositions,
  useCompositionsStore,
  type SubComposition,
} from '../stores/compositions-store'
export { useMotionLayoutDialogStore } from '../components/motion-layout-dialog-store'
export { autoMatchOrphanedClips } from '../utils/media-validation'
export { resolveMediaUrl, resolveMediaUrls } from '../deps/media-library-resolver'
export { importCanvasRenderOrchestrator } from '../deps/export-contract'
export {
  buildSubCompositionInput,
  buildSubCompositionPreviewSignature,
  collectSubCompositionMediaIds,
  getSubCompositionThumbnailFrame,
} from '../utils/sub-composition-preview'
