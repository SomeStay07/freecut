/**
 * Re-export of the shared creator-font module. The canonical definition lives
 * in `@/infrastructure/lottie/creator-font` so the timeline load/render paths
 * can reach it too; this keeps the feature's existing import path stable.
 */
export { CREATOR_FONT, ensureCreatorFont } from '@/infrastructure/lottie/creator-font'
