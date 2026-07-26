# Upstream sync playbook (walterlow/freecut → this fork)

Our fork carries engine work upstream doesn't have yet (headless harness+drivers,
export-audio fixes, inline text spans, crop refit, validation warnings). Upstream
moves fast (the Motion feature landed ~126 commits in July 2026). This is the
checklist for pulling upstream without breaking our engine.

## Ground rules

- **Sync in a dedicated session/worktree**, never mid-montage-work.
- **Land our pending PRs into upstream `staging` FIRST** (fonts/tooling,
  agents-suite, silent-failures). Every merged PR removes a future conflict.
- Merge `origin/main` (their release branch) — not `develop`.
- Never run the sync while a headless render is in flight (shared dist/).

## Known conflict points (state as of 2026-07-26)

| File | Situation | Resolution |
|---|---|---|
| `src/features/keyframes/components/dopesheet-editor/segment-spans.ts` | add/add: we and upstream created it independently | Take upstream's file; keep our `segment-spans.test.ts` guard, adapt imports |
| `src/shared/utils/media-crop.ts` | our `refit` vs their `fitMode: 'fill'` | Already merged on `pr/headless-silent-failures` — copy that resolution |
| `src/features/keyframes/.../dopesheet-timeline-cells.tsx` | our extraction vs their +577 lines | Take their file, re-apply the buildSegmentSpans extraction on top |
| `src/features/export/utils/client-render-engine.ts` | our alpha-cull lines (~2) vs their big refactor | Re-apply our `canBeTransparent` occlusion guard manually; `frame-occlusion.test.ts` verifies |
| `src/headless/**`, `headless/*.mjs` | upstream doesn't touch these | ours wins; expect no conflicts |

## Mandatory verification after merge

1. `npx vp check --no-fmt` — 0 type errors (skip format: upstream's tree may lag our oxfmt).
2. `npm run test:run` — full suite; the only allowed failure is the known
   platform-dependent `hotkey-editor-search` (Cmd vs Ctrl on macOS).
3. `npm run build && npm run headless:test:portable` — node contracts + chrome e2e + media.
4. **Golden smoke on real production data** (workspace `/Users/timurceberda/Documents/FreeCutProjects`):
   - `npm run headless:frame -- --workspace <ws> --project <ws>/_montage/final.json --at 84.5 --out /tmp/sync-check.png`
     → frame renders, brand panel + text intact (eyeball the PNG);
   - 4s render of a speech slice → `ffprobe`: file has an `aac` audio stream
     (guards the no-transitions audio regression).
5. `git diff --stat` review: no unexplained deletions in `src/headless/`, `headless/`.

## After the sync

- Re-run `node scripts/check-fallow-changed-health.mjs --base origin/main` to see
  the new baseline.
- The orchestrator test-coverage debt (`canvas-render-orchestrator.ts` — extract
  pure frame-loop planning + real tests; its current `.test.ts` is a mock-echo,
  not coverage) is scheduled for right after a sync, when upstream churn there
  has been absorbed.
