# FreeCut Engine — Codex operating contract

This repository contains the FreeCut web editor engine. Codex is the primary
agent runtime. `AGENTS.md` and `.agents/skills/` are the active project
contract. Claude-specific instruction and agent surfaces are not supported.

## Stack and environment

- Browser-based multi-track video editor built with React 19, TypeScript, and
  Vite through `vite-plus` (`vp`).
- `VITE_SHOW_DEBUG_PANEL=false` hides the debug panel in development.

## Project skills

Load the matching engine-local skill before specialized work:

- `.agents/skills/changelog/SKILL.md` for weekly changelog work.
- `.agents/skills/translate-app-locales/SKILL.md` for locale additions,
  translation coverage, or i18n audits.
- `.agents/skills/toolchain-notes/SKILL.md` before dependency, TypeScript,
  vite-plus, lint/format, or fallow-baseline changes.
- `.agents/skills/render-pipeline-notes/SKILL.md` before preview, scrubbing,
  transition playback, decoder prewarm, timeline zoom, or capture changes.

Engine source, tests, package scripts, and Git history live here. Montage
projects, renders, and review artifacts live in the external FreeCutProjects
workspace and are not engine authority.

## Toolchain and dependency rules

- Production dependencies are exact-pinned. Keep new production dependencies
  exact-pinned; do not introduce `^` or `~`.
- `onnxruntime-web` uses a deliberate development build and `lucide-react`
  is deliberately held at 0.468.x. Never routine-bump either dependency.
- Use the checked `npm run ...` scripts instead of ad-hoc tool invocations.
- Never bulk-run `fallow fix`. Unused-code allowlists are ratchet baselines,
  not approvals; trace each finding before changing a baseline.
- Product compatibility code whose name contains `legacy` is not Claude
  support. Do not remove storage migrations or legacy-import checks without a
  separate product migration and regression evidence.

## Implementation invariants

- Keep feature dependencies one-directional through existing `deps/` adapters.
- Source trim frames use the source media's native FPS; convert with media
  metadata at timeline/display boundaries.
- Lower timeline track order renders visually higher.
- Preserve lazy initialization and function declarations that avoid production
  bundle temporal-dead-zone failures.
- Preview capture and the render pump share a renderer. Do not introduce
  concurrent `renderFrame` calls; preserve the existing render lock.
- Per-frame playhead motion must not force React rerenders of the host strip.

## Verification

Use the smallest check that proves the change, then broaden as needed:

- `npm run check:codex-contract` for the Codex-only project surface.
- `npm run check` for lint/type diagnostics.
- `npm run test:run -- <test-path>` for focused tests.
- `npm run build` for bundling-sensitive or production-order changes.
- Run boundary and dependency-contract checks when imports or feature ownership
  change.

Do not claim a change is clean without fresh output. Do not modify generated or
unrelated files to make a check pass.

## Git workflow

- `main` is production, `staging` is pre-release integration, and `develop`
  is active development.
- Commit directly to `develop`; do not create feature branches.
- Pull requests target `staging`. Promote `staging` to `main`; do not open
  feature pull requests directly against `main`.
- Use Conventional Commits: `type(scope): description`.
