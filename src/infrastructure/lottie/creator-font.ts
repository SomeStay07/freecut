/**
 * The single font FreeCut uses for generated Lottie text (the Lottie Creator).
 *
 * FreeCut has no glyph outlines, so text renders via dotlottie/thorvg's native
 * font registration: we register a real TTF (thorvg can't use woff2) by name,
 * and emitted text layers reference that same name. Poppins-Regular is served
 * with permissive CORS from jsDelivr's mirror of google/fonts.
 *
 * Lives in `infrastructure/lottie` (not the creator feature) so both the
 * authoring UI and the timeline load/render paths can reach it without crossing
 * a feature boundary — a reloaded project must re-register this font before its
 * creator-Lottie wrappers render text.
 */
export const CREATOR_FONT = 'Poppins'

const CREATOR_FONT_URL =
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/poppins/Poppins-Regular.ttf'

/**
 * Register the creator font with the player (idempotent). Resolves false on
 * failure. The dotlottie provider (heavy WASM) is imported lazily so modules
 * that only need the `CREATOR_FONT` name — e.g. the timeline load path baking
 * wrapper srcs — don't pull the player into their chunk.
 */
export async function ensureCreatorFont(): Promise<boolean> {
  const { ensureLottieFont } = await import('./lottie-frame-provider')
  return ensureLottieFont(CREATOR_FONT, CREATOR_FONT_URL)
}
