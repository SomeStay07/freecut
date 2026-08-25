// Deterministic workspace for the render-parity bench.
//
// Two projects, together covering the paths an upstream sync tends to move:
//   core    — video with embedded audio, a wipe transition, a GPU effect,
//             web-font text, a rounded/stroked shape, a pre-composition
//             rendered at half the project canvas, keyframes, sidechain ducking
//   effects — three stacked colour effects (the inline colour-batch path), two
//             different transition presets, a 29.97fps source, an alpha mask,
//             inline text spans (per-span colour + underline), ducking
//
// Media is synthesised with ffmpeg so the fixture is reproducible on any
// machine and carries no project assets.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const track = (id, name, kind, order) => ({
  id,
  name,
  kind,
  height: 60,
  locked: false,
  syncLock: true,
  visible: true,
  muted: false,
  solo: false,
  order,
  items: [],
})

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: 'inherit',
  })
  if (result.error?.code === 'ENOENT') throw new Error('ffmpeg is required for the parity bench')
  if (result.status !== 0) throw new Error(`ffmpeg exited with ${result.status}`)
}

const MEDIA = [
  {
    id: 'clipA',
    file: 'clipA.mp4',
    source: 'testsrc2=size=1920x1080:rate=30:duration=4',
    tone: 'sine=frequency=220:duration=4:sample_rate=48000',
    metadata: { duration: 4, width: 1920, height: 1080, fps: 30 },
  },
  {
    id: 'clipB',
    file: 'clipB.mp4',
    source: 'smptebars=size=1920x1080:rate=30:duration=4',
    tone: 'sine=frequency=330:duration=4:sample_rate=48000',
    metadata: { duration: 4, width: 1920, height: 1080, fps: 30 },
  },
  {
    // Non-integer frame rate: guards MediaBunny frame-rate handling.
    id: 'clipC',
    file: 'clipC.mp4',
    source: 'testsrc=size=1920x1080:rate=30000/1001:duration=4',
    tone: 'sine=frequency=180:duration=4:sample_rate=48000',
    metadata: { duration: 3.970633, width: 1920, height: 1080, fps: 29.97 },
  },
]

function writeMedia(workspace) {
  for (const entry of MEDIA) {
    const dir = path.join(workspace, 'media', entry.id)
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, entry.file)
    if (!fs.existsSync(filePath)) {
      ffmpeg([
        '-f',
        'lavfi',
        '-i',
        entry.source,
        '-f',
        'lavfi',
        '-i',
        entry.tone,
        '-c:v',
        'libx264',
        '-profile:v',
        'high',
        '-pix_fmt',
        'yuv420p',
        '-g',
        '15',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-shortest',
        filePath,
      ])
    }
    fs.writeFileSync(
      path.join(dir, 'metadata.json'),
      JSON.stringify(
        {
          id: entry.id,
          storageType: 'workspace',
          fileName: entry.file,
          fileSize: fs.statSync(filePath).size,
          createdAt: 1_735_689_600_000,
          mimeType: 'video/mp4',
          codec: 'avc1.640028',
          bitrate: 6_000_000,
          audioCodec: 'aac',
          audioCodecSupported: true,
          ...entry.metadata,
        },
        null,
        2,
      ),
    )
  }

  const toneDir = path.join(workspace, 'media', 'tone')
  fs.mkdirSync(toneDir, { recursive: true })
  const tonePath = path.join(toneDir, 'tone.wav')
  if (!fs.existsSync(tonePath)) {
    ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=8:sample_rate=48000',
      '-c:a',
      'pcm_s16le',
      tonePath,
    ])
  }
  fs.writeFileSync(
    path.join(toneDir, 'metadata.json'),
    JSON.stringify(
      {
        id: 'tone',
        storageType: 'workspace',
        fileName: 'tone.wav',
        fileSize: fs.statSync(tonePath).size,
        createdAt: 1_735_689_600_000,
        mimeType: 'audio/wav',
        duration: 8,
        width: 0,
        height: 0,
        fps: 0,
        codec: 'pcm-s16',
        bitrate: 1_536_000,
        audioCodec: 'pcm-s16',
        audioCodecSupported: true,
      },
      null,
      2,
    ),
  )
}

const videoItem = (id, mediaId, from, durationInFrames, extra = {}) => ({
  id,
  type: 'video',
  trackId: 'video-1',
  from,
  durationInFrames,
  label: id,
  mediaId,
  src: '',
  volume: 1,
  sourceStart: 0,
  sourceEnd: durationInFrames,
  sourceDuration: 120,
  sourceFps: 30,
  sourceWidth: 1920,
  sourceHeight: 1080,
  speed: 1,
  ...extra,
})

const textTransform = (x, y, width, height) => ({
  x,
  y,
  width,
  height,
  anchorX: width / 2,
  anchorY: height / 2,
  rotation: 0,
  opacity: 1,
})

const projectShell = (id, backgroundColor, duration) => ({
  id,
  name: id,
  description: '',
  schemaVersion: 15,
  createdAt: 1_735_689_600_000,
  updatedAt: 1_735_689_600_000,
  duration,
  metadata: { width: 1920, height: 1080, fps: 30, backgroundColor },
})

function coreProject() {
  return {
    ...projectShell('parity-core', '#101418', 180),
    timeline: {
      masterBusDb: 0,
      tracks: [
        track('video-4', 'Text', 'video', 0),
        track('video-3', 'Shape', 'video', 1),
        track('video-2', 'Precomp', 'video', 2),
        track('video-1', 'V1', 'video', 3),
        track('audio-1', 'A1', 'audio', 4),
      ],
      items: [
        videoItem('clipA', 'clipA', 0, 60, {
          audioDucking: { duckOthersDb: -14, attackSec: 0.08, releaseSec: 0.25 },
        }),
        // Handles on both sides so the transition below is not clamped away.
        videoItem('clipB', 'clipB', 60, 60, { sourceStart: 30, sourceEnd: 90 }),
        {
          id: 'text-1',
          type: 'text',
          trackId: 'video-4',
          from: 6,
          durationInFrames: 120,
          label: 'Title',
          text: 'Parity 1920x1080',
          color: '#ffffff',
          fontSize: 96,
          fontFamily: 'Inter',
          fontWeight: 'bold',
          textAlign: 'center',
          verticalAlign: 'middle',
          transform: { ...textTransform(0, -300, 1400, 200) },
        },
        {
          id: 'shape-1',
          type: 'shape',
          trackId: 'video-3',
          from: 0,
          durationInFrames: 180,
          label: 'Card',
          shapeType: 'rectangle',
          fillColor: '#ff7a1a',
          fillEnabled: true,
          strokeColor: '#ffffff',
          strokeWidth: 6,
          strokeEnabled: true,
          cornerRadius: 24,
          transform: { ...textTransform(-520, 320, 520, 160), opacity: 0.9, cornerRadius: 32 },
        },
        {
          id: 'comp-1',
          type: 'composition',
          trackId: 'video-2',
          from: 20,
          durationInFrames: 120,
          label: 'Precomp',
          compositionId: 'sub-1',
          compositionWidth: 960,
          compositionHeight: 540,
          transform: { ...textTransform(540, 260, 640, 360) },
        },
        {
          id: 'music',
          type: 'audio',
          trackId: 'audio-1',
          from: 0,
          durationInFrames: 180,
          label: 'Music',
          mediaId: 'tone',
          src: '',
          volume: 0.8,
          sourceStart: 0,
          sourceEnd: 180,
          sourceDuration: 240,
          sourceFps: 30,
          speed: 1,
        },
      ],
      transitions: [],
      keyframes: [],
      compositions: [
        {
          id: 'sub-1',
          name: 'Sub',
          editorKind: 'sequence',
          fps: 30,
          width: 960,
          height: 540,
          durationInFrames: 120,
          backgroundColor: '#1b2430',
          tracks: [track('sub-video-1', 'V1', 'video', 0), track('sub-video-2', 'V2', 'video', 1)],
          items: [
            {
              id: 'sub-text',
              type: 'text',
              trackId: 'sub-video-1',
              from: 0,
              durationInFrames: 120,
              label: 'SubText',
              text: 'precomp',
              color: '#7ad1ff',
              fontSize: 64,
              fontFamily: 'Inter',
              fontWeight: 'bold',
              textAlign: 'center',
              verticalAlign: 'middle',
              transform: { ...textTransform(0, 0, 800, 120) },
            },
            {
              id: 'sub-shape',
              type: 'shape',
              trackId: 'sub-video-2',
              from: 0,
              durationInFrames: 120,
              label: 'SubCard',
              shapeType: 'ellipse',
              fillColor: '#ffffff',
              fillEnabled: true,
              transform: { ...textTransform(-300, -160, 200, 200), opacity: 0.5 },
            },
          ],
          transitions: [],
          keyframes: [],
        },
      ],
    },
  }
}

function effectsProject() {
  const clip = (id, mediaId, from, extra = {}) =>
    videoItem(id, mediaId, from, 50, {
      sourceStart: 30,
      sourceEnd: 80,
      sourceDuration: 119,
      ...extra,
    })
  return {
    ...projectShell('parity-effects', '#0d1117', 150),
    timeline: {
      masterBusDb: 0,
      tracks: [
        track('video-5', 'Text', 'video', 0),
        track('video-4', 'Mask', 'video', 1),
        track('video-3', 'Precomp', 'video', 2),
        track('video-1', 'V1', 'video', 3),
        track('audio-1', 'A1', 'audio', 4),
      ],
      items: [
        clip('clipA', 'clipA', 0, {
          audioDucking: { duckOthersDb: -12, attackSec: 0.05, releaseSec: 0.3 },
        }),
        clip('clipC', 'clipC', 50),
        clip('clipB', 'clipB', 100),
        {
          id: 'text-2',
          type: 'text',
          trackId: 'video-5',
          from: 0,
          durationInFrames: 150,
          label: 'Inline',
          text: 'growth up 81% this quarter',
          // Inline spans: recolour + underline INSIDE one wrapped line.
          textSpans: [
            { text: 'growth ' },
            { text: 'up 81%', color: '#ff7a1a', underline: true },
            { text: ' this quarter' },
          ],
          spanLayout: 'inline',
          color: '#ffffff',
          fontSize: 84,
          fontFamily: 'Inter',
          fontWeight: 'bold',
          textAlign: 'center',
          verticalAlign: 'middle',
          transform: { ...textTransform(0, -320, 1500, 180) },
        },
        {
          id: 'mask-1',
          type: 'shape',
          trackId: 'video-4',
          from: 0,
          durationInFrames: 150,
          label: 'Mask',
          shapeType: 'ellipse',
          fillColor: '#ffffff',
          fillEnabled: true,
          isMask: true,
          maskType: 'alpha',
          maskFeather: 24,
          maskOpacity: 85,
          maskInvert: false,
          transform: { ...textTransform(-420, 180, 760, 520) },
        },
        {
          id: 'comp-2',
          type: 'composition',
          trackId: 'video-3',
          from: 10,
          durationInFrames: 130,
          label: 'Precomp',
          compositionId: 'sub-2',
          compositionWidth: 960,
          compositionHeight: 540,
          transform: { ...textTransform(520, 250, 720, 405) },
        },
        {
          id: 'music2',
          type: 'audio',
          trackId: 'audio-1',
          from: 0,
          durationInFrames: 150,
          label: 'Music',
          mediaId: 'tone',
          src: '',
          volume: 0.9,
          sourceStart: 0,
          sourceEnd: 150,
          sourceDuration: 240,
          sourceFps: 30,
          speed: 1,
        },
      ],
      transitions: [],
      keyframes: [],
      compositions: [
        {
          id: 'sub-2',
          name: 'Sub2',
          editorKind: 'sequence',
          fps: 30,
          width: 960,
          height: 540,
          durationInFrames: 130,
          backgroundColor: '#182230',
          tracks: [
            track('sub2-video-1', 'V1', 'video', 0),
            track('sub2-video-2', 'V2', 'video', 1),
          ],
          items: [
            {
              id: 'sub2-text',
              type: 'text',
              trackId: 'sub2-video-1',
              from: 0,
              durationInFrames: 130,
              label: 'SubText',
              text: 'nested',
              color: '#7ad1ff',
              fontSize: 72,
              fontFamily: 'Inter',
              fontWeight: 'bold',
              textAlign: 'center',
              verticalAlign: 'middle',
              transform: { ...textTransform(0, -60, 700, 130) },
            },
            {
              id: 'sub2-shape',
              type: 'shape',
              trackId: 'sub2-video-2',
              from: 0,
              durationInFrames: 130,
              label: 'SubCard',
              shapeType: 'rectangle',
              fillColor: '#ff7a1a',
              fillEnabled: true,
              cornerRadius: 18,
              transform: { ...textTransform(0, 140, 520, 110), opacity: 0.85 },
            },
          ],
          transitions: [],
          keyframes: [],
        },
      ],
    },
  }
}

/**
 * Ops applied through the real authoring path, so the bench also covers
 * transition/effect/keyframe authoring rather than hand-written JSON.
 */
export const PROJECTS = [
  {
    id: 'parity-core',
    build: coreProject,
    ops: [
      {
        op: 'addTransition',
        leftClipId: 'clipA',
        rightClipId: 'clipB',
        durationInFrames: 20,
        presentation: 'wipe',
        direction: 'from-left',
      },
      {
        op: 'addEffect',
        itemId: 'clipB',
        gpuEffectType: 'gpu-brightness',
        params: { brightness: 0.15 },
      },
      {
        op: 'addKeyframe',
        itemId: 'text-1',
        property: 'opacity',
        frame: 6,
        value: 0,
        easing: 'ease-out',
      },
      {
        op: 'addKeyframe',
        itemId: 'text-1',
        property: 'opacity',
        frame: 26,
        value: 1,
        easing: 'ease-out',
      },
      {
        op: 'addKeyframe',
        itemId: 'shape-1',
        property: 'rotation',
        frame: 0,
        value: 0,
        easing: 'linear',
      },
      {
        op: 'addKeyframe',
        itemId: 'shape-1',
        property: 'rotation',
        frame: 180,
        value: 25,
        easing: 'linear',
      },
    ],
  },
  {
    id: 'parity-effects',
    build: effectsProject,
    ops: [
      {
        op: 'addTransition',
        leftClipId: 'clipA',
        rightClipId: 'clipC',
        durationInFrames: 20,
        presentation: 'wipe',
        direction: 'from-left',
      },
      {
        op: 'addTransition',
        leftClipId: 'clipC',
        rightClipId: 'clipB',
        durationInFrames: 20,
        presentation: 'lightLeakBurn',
      },
      {
        op: 'addEffect',
        itemId: 'clipA',
        gpuEffectType: 'gpu-brightness',
        params: { brightness: 0.12 },
      },
      {
        op: 'addEffect',
        itemId: 'clipA',
        gpuEffectType: 'gpu-contrast',
        params: { contrast: 0.25 },
      },
      {
        op: 'addEffect',
        itemId: 'clipA',
        gpuEffectType: 'gpu-saturation',
        params: { saturation: 0.4 },
      },
      {
        op: 'addEffect',
        itemId: 'clipB',
        gpuEffectType: 'gpu-gaussian-blur',
        params: { radius: 6 },
      },
      {
        op: 'addKeyframe',
        itemId: 'comp-2',
        property: 'opacity',
        frame: 10,
        value: 0,
        easing: 'ease-out',
      },
      {
        op: 'addKeyframe',
        itemId: 'comp-2',
        property: 'opacity',
        frame: 40,
        value: 1,
        easing: 'ease-out',
      },
      {
        op: 'addKeyframe',
        itemId: 'mask-1',
        property: 'x',
        frame: 0,
        value: -420,
        easing: 'linear',
      },
      {
        op: 'addKeyframe',
        itemId: 'mask-1',
        property: 'x',
        frame: 150,
        value: 300,
        easing: 'linear',
      },
    ],
  },
]

/**
 * Write the media, and the raw projects only when asked. Rewriting an existing
 * project would throw away the authoring ops already applied to it — and both
 * sides of a comparison must render byte-identical input, so the second run
 * must leave the frozen JSON alone.
 */
export function buildWorkspace(workspace, { writeProjects = true } = {}) {
  fs.mkdirSync(workspace, { recursive: true })
  writeMedia(workspace)
  if (!writeProjects) return workspace
  for (const project of PROJECTS) {
    const dir = path.join(workspace, 'projects', project.id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project.build(), null, 2))
  }
  return workspace
}
