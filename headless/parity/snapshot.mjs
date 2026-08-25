#!/usr/bin/env node
// Render-parity bench: renders a frozen fixture workspace and records hashes
// that can be compared across two builds of the engine.
//
// Usage:
//   node headless/parity/snapshot.mjs --label before
//   node headless/parity/snapshot.mjs --label after --workspace .parity/ws
//
// Options:
//   --label <name>       Snapshot name; output lands in .parity/snap-<name>/
//   --workspace <dir>    Fixture workspace (default .parity/ws). Reused when it
//                        already exists, so both sides render identical input.
//   --out <dir>          Override the snapshot output directory.
//   --freeze             Re-apply the authoring ops and rewrite the projects.
//                        Do this once, on the FIRST side; the second side must
//                        reuse the frozen JSON, not regenerate it.
//
// Requires ffmpeg/ffprobe on PATH and a built dist/ (npm run build).
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWorkspace, PROJECTS } from './fixtures.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (!key.startsWith('--')) continue
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args[key.slice(2)] = true
    } else {
      args[key.slice(2)] = next
      i += 1
    }
  }
  return args
}

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited with ${result.status}\n${result.stderr ?? ''}`,
    )
  }
  return result.stdout ?? ''
}

const ffmpegQuiet = (args) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
const md5 = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')

/** Apply the authoring ops once, then treat the resulting JSON as frozen input. */
function freezeProjects(workspace) {
  for (const project of PROJECTS) {
    const opsPath = path.join(workspace, `${project.id}.ops.json`)
    fs.writeFileSync(opsPath, JSON.stringify(project.ops, null, 2))
    run('node', [
      'headless/edit.mjs',
      '--workspace',
      workspace,
      '--project',
      project.id,
      '--ops',
      opsPath,
      '--in-place',
    ])
  }
}

/** Frames chosen to land on the effect stack, both transitions, and plain clips. */
const FRAME_TIMES = {
  'parity-core': ['0.30', '1.90', '3.00', '4.90'],
  'parity-effects': ['0.50', '2.00', '3.33', '4.50'],
}

const RENDER_VARIANTS = [
  { name: 'full', args: ['--codec', 'h264', '--container', 'mp4', '--quality', 'high'] },
  // Canvas != composition size: the logical-canvas transform path.
  { name: 'scaled', args: ['--codec', 'h264', '--container', 'mp4', '--resolution', '1280x720'] },
  // Windowed export: bounded audio/video decode.
  {
    name: 'window',
    args: ['--codec', 'h264', '--container', 'mp4', '--in', '1.2', '--duration', '1.6'],
  },
  { name: 'audio', args: ['--audio-only', '--container', 'wav'] },
]

function renderVariants(workspace, projectId, outDir) {
  const lines = []
  for (const variant of RENDER_VARIANTS) {
    const ext = variant.name === 'audio' ? 'wav' : 'mp4'
    const outFile = path.join(outDir, `${projectId}.${variant.name}.${ext}`)
    run('node', [
      'headless/render.mjs',
      '--workspace',
      workspace,
      '--project',
      projectId,
      '--out',
      outFile,
      ...variant.args,
    ])
    if (ext === 'wav') {
      lines.push(`${projectId} ${variant.name} audio : ${md5(outFile)}`)
      continue
    }
    const frameHashes = path.join(outDir, `${projectId}.${variant.name}.framemd5`)
    ffmpegQuiet(['-i', outFile, '-an', '-f', 'framemd5', frameHashes])
    const decodedAudio = path.join(outDir, `${projectId}.${variant.name}.wav`)
    ffmpegQuiet([
      '-i',
      outFile,
      '-vn',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-c:a',
      'pcm_s16le',
      decodedAudio,
    ])
    const frames = fs
      .readFileSync(frameHashes, 'utf8')
      .split('\n')
      .filter((line) => line && !line.startsWith('#'))
    const digest = crypto.createHash('md5').update(frames.join('\n')).digest('hex')
    const probe = JSON.parse(
      run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', outFile], {
        capture: true,
      }),
    )
    const video = probe.streams.find((stream) => stream.codec_type === 'video') ?? {}
    const audio = probe.streams.find((stream) => stream.codec_type === 'audio') ?? {}
    lines.push(`${projectId} ${variant.name} video : ${digest} (${frames.length} frames)`)
    lines.push(`${projectId} ${variant.name} audio : ${md5(decodedAudio)}`)
    lines.push(
      `${projectId} ${variant.name} probe : ${video.codec_name}/${video.profile} ` +
        `${video.width}x${video.height} fps=${video.avg_frame_rate} ` +
        `| ${audio.codec_name} ${audio.channels}ch ${audio.sample_rate} | dur=${probe.format.duration}`,
    )
  }
  return lines
}

function grabFrames(workspace, projectId, outDir) {
  const lines = []
  for (const at of FRAME_TIMES[projectId]) {
    const outFile = path.join(outDir, `${projectId}.frame-${at}.png`)
    run('node', [
      'headless/frame.mjs',
      '--workspace',
      workspace,
      '--project',
      projectId,
      '--at',
      at,
      '--out',
      outFile,
    ])
    lines.push(`${projectId} frame ${at} : ${md5(outFile)}`)
  }
  return lines
}

function dumpLayout(workspace, projectId, outDir) {
  const json = run(
    'node',
    ['headless/layout.mjs', '--workspace', workspace, '--project', projectId, '--at', '1.00'],
    { capture: true },
  )
  fs.writeFileSync(path.join(outDir, `${projectId}.layout.json`), json)
  const layout = JSON.parse(json)
  return layout.items.map(
    (item) =>
      `${projectId} layout ${item.id} : x=${item.x} y=${item.y} w=${item.width} h=${item.height}` +
      (item.textLayout ? ` textLayout=${JSON.stringify(item.textLayout)}` : ''),
  )
}

const args = parseArgs(process.argv.slice(2))
const label = args.label ?? 'snapshot'
const workspace = path.resolve(ROOT, args.workspace ?? path.join('.parity', 'ws'))
const outDir = path.resolve(ROOT, args.out ?? path.join('.parity', `snap-${label}`))

if (!fs.existsSync(path.join(ROOT, 'dist', 'headless.html'))) {
  throw new Error('dist/headless.html is missing; run npm run build first')
}
const freshWorkspace = !fs.existsSync(path.join(workspace, 'projects'))
const authoring = freshWorkspace || Boolean(args.freeze)
buildWorkspace(workspace, { writeProjects: authoring })
if (authoring) freezeProjects(workspace)
else console.log(`Reusing frozen fixtures in ${path.relative(ROOT, workspace)}`)

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const report = [
  `label: ${label}`,
  `head: ${run('git', ['rev-parse', '--short', 'HEAD'], { capture: true }).trim()}`,
  `mediabunny: ${JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'mediabunny', 'package.json'), 'utf8')).version}`,
  '',
]
for (const project of PROJECTS) {
  report.push(
    ...grabFrames(workspace, project.id, outDir),
    ...dumpLayout(workspace, project.id, outDir),
    ...renderVariants(workspace, project.id, outDir),
    '',
  )
}
fs.writeFileSync(path.join(outDir, 'report.txt'), `${report.join('\n')}\n`)
console.log(report.join('\n'))
console.log(`\nSnapshot written to ${path.relative(ROOT, outDir)}`)
