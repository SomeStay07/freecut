# Render-parity bench

Proves an engine change did not move a single pixel or sample — or shows exactly
where it did. Built for upstream syncs, but useful before any render-path edit.

Passing tests do not cover this: they assert behaviour we thought to assert. The
bench compares the actual rendered bytes of the same frozen project across two
builds.

## What it covers

Two fixture projects, both 1920×1080@30 with ffmpeg-synthesised media (nothing
from a real workspace, so it runs anywhere):

|             | `parity-core`               | `parity-effects`                               |
| ----------- | --------------------------- | ---------------------------------------------- |
| video       | clip with embedded audio    | three clips, one at **29.97fps**               |
| transitions | `wipe`                      | `wipe` + `lightLeakBurn`                       |
| effects     | one GPU effect              | **three stacked colour effects** + blur        |
| text        | web font, keyframed opacity | **inline spans** (per-span colour + underline) |
| shapes      | rounded, stroked, rotating  | **alpha mask** with feather, keyframed         |
| nesting     | pre-comp 960×540            | pre-comp 960×540                               |
| audio       | sidechain ducking           | sidechain ducking                              |

Each project renders four ways: full, `--resolution 1280x720` (the
logical-canvas transform path), a windowed slice (`--in/--duration`, bounded
decode), and `--audio-only`. Golden frames land on the transitions and on the
effect stack; `layout.mjs` records measured text geometry.

## Running it

Requires `ffmpeg`/`ffprobe` on PATH.

```bash
# 1. On the OLD code — check it out, restore its dependencies, build:
git checkout <pre-change-ref>
npm ci && npm run build
node headless/parity/snapshot.mjs --label before

# 2. Back on the new code:
git checkout <your-branch>
npm ci && npm run build
node headless/parity/snapshot.mjs --label after

# 3. Compare:
node headless/parity/compare.mjs .parity/snap-before .parity/snap-after
```

`.parity/ws` is created on the first run and **reused** afterwards: the second
side must render the exact same input, so never regenerate it between the two
snapshots. Pass `--freeze` only when you deliberately want to re-author the
fixtures.

## Reading the result

Take **two snapshots on the same code first**. They must be identical; if they
are not, the pipeline is not deterministic on this machine and no later diff
means anything.

When something differs, `compare.mjs` reports per-frame PSNR:

- **under ~45 dB** — a real visual change. Look at it.
- **~60 dB and above** — encoder reference propagation. A changed frame keeps
  the rest of its GOP slightly different until the next keyframe; this is not a
  content change.

A difference is not automatically a regression. When the 2026-08-25 upstream
sync moved the `lightLeakBurn` window, measuring each transition frame against
the outgoing and incoming clips showed the OLD build had been playing that
transition backwards — the change was the fix.

Beware of "identical because equally broken": for anything that could silently
stop applying, add a positive control. Rendering a ducking-free copy of the
project and confirming the mix is louder proves ducking still runs.
