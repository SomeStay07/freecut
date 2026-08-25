#!/usr/bin/env node
// Compare two parity snapshots and localise every difference.
//
// Usage: node headless/parity/compare.mjs .parity/snap-before .parity/snap-after
//
// Differences in a rendered video are reported per frame with PSNR, because an
// encoder propagates a changed frame through the rest of its GOP: a tail of
// frames around ~60 dB is reference propagation, not a visual change, while a
// real difference sits far lower.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [dirA, dirB] = process.argv.slice(2)
if (!dirA || !dirB) {
  console.error('Usage: node headless/parity/compare.mjs <snapshot-a> <snapshot-b>')
  process.exit(2)
}

function readReport(dir) {
  const file = path.join(dir, 'report.txt')
  if (!fs.existsSync(file)) throw new Error(`No report.txt in ${dir}`)
  const entries = new Map()
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const index = line.indexOf(' : ')
    if (index > 0) entries.set(line.slice(0, index).trim(), line.slice(index + 3).trim())
  }
  return entries
}

/**
 * Per-frame PSNR between two encodes of the same source. Throws rather than
 * returning an empty list: this tool is the oracle for "did the engine move a
 * pixel", so a silent ffmpeg failure must never read as "nothing differs".
 */
function framePsnr(fileA, fileB) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      fileA,
      '-i',
      fileB,
      '-lavfi',
      'psnr=stats_file=-',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8' },
  )
  if (result.error) throw new Error(`ffmpeg could not be run: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(
      `ffmpeg psnr failed (exit ${result.status}) for ${fileA} vs ${fileB}\n${result.stderr ?? ''}`,
    )
  }
  const rows = []
  for (const line of (result.stdout ?? '').split('\n')) {
    const frame = /\bn:(\d+)\b/.exec(line)
    const psnr = /\bpsnr_avg:([\d.]+|inf)\b/.exec(line)
    if (frame && psnr && psnr[1] !== 'inf')
      rows.push({ frame: Number(frame[1]), psnr: Number(psnr[1]) })
  }
  return rows
}

const reportA = readReport(dirA)
const reportB = readReport(dirB)
const keys = [...new Set([...reportA.keys(), ...reportB.keys()])].sort()

let differing = 0
for (const key of keys) {
  const a = reportA.get(key)
  const b = reportB.get(key)
  if (a === b) continue
  differing += 1
  console.log(`DIFF ${key}`)
  console.log(`   a: ${a ?? '(missing)'}`)
  console.log(`   b: ${b ?? '(missing)'}`)

  const videoMatch = /^(\S+) (\S+) video$/.exec(key)
  if (!videoMatch) continue
  const [, project, variant] = videoMatch
  const fileA = path.join(dirA, `${project}.${variant}.mp4`)
  const fileB = path.join(dirB, `${project}.${variant}.mp4`)
  if (!fs.existsSync(fileA) || !fs.existsSync(fileB)) {
    console.log('   (cannot localise: one of the rendered files is missing from the snapshot)')
    continue
  }
  const rows = framePsnr(fileA, fileB)
  const visual = rows.filter((row) => row.psnr < 45)
  const propagation = rows.filter((row) => row.psnr >= 45)
  console.log(
    `   frames differing: ${rows.length} | visually different: ${visual.length}` +
      (visual.length ? ` (frames ${visual[0].frame}-${visual.at(-1).frame})` : '') +
      ` | encoder propagation: ${propagation.length}`,
  )
  for (const row of visual.slice(0, 5)) console.log(`     frame ${row.frame} psnr=${row.psnr}`)
}

console.log(
  differing === 0
    ? `\nIDENTICAL: ${keys.length} recorded values match across both snapshots.`
    : `\n${differing} of ${keys.length} recorded values differ.`,
)
process.exit(differing === 0 ? 0 : 1)
