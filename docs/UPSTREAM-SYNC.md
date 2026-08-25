# Upstream sync playbook (walterlow/freecut → this fork)

Most of what this fork used to carry alone is now upstream (PRs #353..#362 landed
2026-07-30..31: ducking, transition authoring + strict validation, textLayout,
transform rigging, frame/layout tooling, the no-transitions audio fix, equal-power
fade). What still lives only here: the headless service/lifecycle layer
(checkpoint operations, workspace media import, final-render probe), this playbook,
and whatever is mid-flight. Upstream moves fast (the Motion wave was ~126 commits in
July 2026). This is the checklist for pulling upstream without breaking our engine.

## Ground rules

- **Sync in a dedicated session/worktree**, never mid-montage-work.
- **Land our pending PRs into upstream FIRST.** Every merged PR removes a future
  conflict. (Since 2026-07-31 upstream accepts our PRs again — #353..#362 are in.)
- **Our working line is `develop`, tracking `origin/develop`** — not `main`.
  Local `main` is the retired pre-2026-08 fork line; do not sync it.
- Merge our own `fork/develop` BEFORE `origin/develop`, so parallel headless work
  is reconciled while the upstream delta is still out of the picture.
- Never run the sync while a headless render is in flight (shared dist/).
- Local Node is 26.x, CI is Node 22: `npm run test:run` needs
  `NODE_OPTIONS="--localstorage-file=<path>"` or ~570 DOM tests fail on an
  environment quirk, not on code.

## Sync log

- **2026-08-25 — synced `develop` through upstream `origin/develop` @727dcf7a (33 commits,
  03.08→16.08) plus our own `fork/develop` (11 headless commits).** Zero conflicts against
  upstream; all five conflicts came from OUR two parallel headless lines (`serve.mjs`,
  `lifecycle-e2e.mjs`, `lifecycle-contract.test.mjs`, `operation-queue.mjs`,
  `service-status.mjs` add/add). `c7e163df` turned out to be a near-duplicate of the
  checkpoint-iteration work — `service-status.mjs` was byte-identical bar one comment.
  Resolution: take the fork side (a superset) everywhere except one `lifecycle-e2e.mjs`
  block, which was unioned (our REVISION_CONFLICT/traversal assertions + their checkpoint
  flow), dropping the duplicated restart section. Audited afterwards: no route, operation
  kind, export or assertion topic from either parent was lost (merged e2e carries 87
  assertions vs 50/76 in the parents). Deps: mediabunny 1.50.8 → 1.54.0.
  **Render parity: byte-identical everywhere except the `lightLeakBurn` transition**, which
  upstream fixed in b435842c — measured objectively, the old code played that transition
  BACKWARDS (start of the window sat closer to the incoming clip, end closer to the
  outgoing one). Frames 111-120 differ only at PSNR ~63 dB (GOP reference propagation).
  Also de-flaked the `/v1/status` render-progress assertion (a 1s render could finish
  between two 25ms polls; it failed 2 of 3 runs BEFORE the sync).

- **2026-07-26 — synced through upstream #347 (+126, the Motion wave).** Only 2 real
  conflicts (segment-spans add/add, media-crop refit-vs-fitMode) — resolved per the
  table below. Upstream DID touch `headless/lib/http-security.mjs` (canonical
  missing-path resolution), breaking the macOS `/var -> /private/var` tmpdir
  assumption in `http-security.test.mjs` — fixture now realpaths its root. Upstream
  also dropped `calculateMediaDrawDimensions` (replaced by `fitMode` in
  `calculateMediaCropLayout`) — its tests removed. Driver page-boot deduped into
  `withHarnessPage` (page-session.mjs) to green the changed-health gate.
  The "upstream doesn't touch headless/\*\*" assumption below is now FALSE — check
  `git log origin/main -- headless src/headless` before the next sync.

## Known conflict points (state as of 2026-07-26, consumed by that sync — verify against the next delta)

| File                                                                  | Situation                                                                                    | Resolution                                                                                             |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/features/keyframes/components/dopesheet-editor/segment-spans.ts` | add/add: we and upstream created it independently                                            | Take upstream's file; keep our `segment-spans.test.ts` guard, adapt imports                            |
| `src/shared/utils/media-crop.ts`                                      | our `refit` vs their `fitMode: 'fill'`                                                       | Already merged on `pr/headless-silent-failures` — copy that resolution                                 |
| `src/features/keyframes/.../dopesheet-timeline-cells.tsx`             | our extraction vs their +577 lines                                                           | Take their file, re-apply the buildSegmentSpans extraction on top                                      |
| `src/features/export/utils/client-render-engine.ts`                   | our alpha-cull lines (~2) vs their big refactor                                              | Re-apply our `canBeTransparent` occlusion guard manually; `frame-occlusion.test.ts` verifies           |
| `src/headless/**`, `headless/*.mjs`                                   | upstream DOES touch these since 2026-07 (security fix), though the 08.03→08.16 delta did not | check `git log origin/develop -- headless src/headless` first; ours wins only where upstream is silent |

## Mandatory verification after merge

1. `npx vp check --no-fmt` — 0 type errors (skip format: upstream's tree may lag our oxfmt).
2. `npm run test:run` — full suite; the only allowed failure is the known
   platform-dependent `hotkey-editor-search` (Cmd vs Ctrl on macOS).
3. `npm run build && npm run headless:test:portable` — node contracts + chrome e2e + media.
4. **Render-parity bench (the check that actually catches engine drift).** Build a
   frozen fixture workspace and render it on BOTH sides — check out the pre-sync commit,
   `npm ci` (so the old dependency versions come back), `npm run build`, render, then
   return. Compare: golden-frame md5s, per-frame `ffmpeg -f framemd5` digests, decoded
   PCM md5 of the audio, `astats`, and `ffprobe` stream summaries. Take TWO snapshots on
   the same code first to prove the pipeline is bit-deterministic, otherwise a diff means
   nothing. Cover the paths upstream touches: batched GPU colour effects, two different
   transition presets, a non-integer-fps source, an alpha mask, inline text spans,
   a pre-composition, ducking — rendered full, at `--resolution` (logical-canvas path),
   as a windowed slice (`--in/--duration`), and `--audio-only`. Localise every difference
   with per-frame PSNR before calling it a regression: an encoder GOP tail reads ~63 dB,
   a real change reads under ~35 dB. Add a positive control for anything that could be
   "identically broken" (e.g. render a ducking-free copy and confirm the mix is louder).
5. **App smoke**: `npm run preview:perf`, then load `/`, `/projects`, `/changelog`,
   `/docs`, `/editor` in headless Chrome and require zero console errors.
6. `git diff --stat` review: no unexplained deletions in `src/headless/`, `headless/`.
7. Merge audit: for every hand-resolved file, diff the merged surface against BOTH
   parents (exports, routes, operation kinds, assertion topics) and require the result
   to be their union — passing tests do not prove a conflict was resolved completely.

## After the sync

- Re-run `node scripts/check-fallow-changed-health.mjs --base origin/main` to see
  the new baseline.
- ~~The orchestrator test-coverage debt~~ **Closed 2026-07-27**: the frame loop
  now lives in `pipelined-frame-loop.ts` (real driver tests replaced the
  mock-echo), packet-remux eligibility in `packet-remux-plan.ts`, the subtitle
  mode matrix in `resolveSubtitleExportPlan`, and `shouldRenderItem` in
  `render-engine-predicates.ts` — all table-tested, pixel parity verified
  (identical golden-frame md5 before/after). On the next sync, resolve upstream
  changes to `renderComposition`'s loop by re-diffing `runPipelinedFrameLoop`
  against upstream's loop body, not by textual merge.
- ~~Known pre-existing red gate~~ **Cleared 2026-07-27** (per-export trace, no
  bulk fix): deleted the `TextAnimationSection` wrapper (upstream unwired it in
  bd063cee — the Motion tab uses `AnimationPresetLibrary` now) and the dead
  `getVisiblePlayheadClientX`; un-exported the internally-used
  `notifyOnMouseDragIntent`; dropped duplicate contract re-exports
  (`getEdgeScrollDelta`/`getPlayheadEdgeScrollVelocity` from
  `keyframes/deps/timeline-contract.ts` — consumers go through
  `timeline-playhead-contract.ts`; `getEffectPropertyBaseValue` from
  `editor/deps/timeline-motion-contract.ts`); removed 4 stale allowlist entries
  (3 unused-exports + `Clock.setAudioContext` in unused-class-members). All
  ratchet gates green.
