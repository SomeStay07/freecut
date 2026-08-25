#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const required = [
  'AGENTS.md',
  '.agents/skills/changelog/SKILL.md',
  '.agents/skills/translate-app-locales/SKILL.md',
  '.agents/skills/toolchain-notes/SKILL.md',
  '.agents/skills/render-pipeline-notes/SKILL.md',
]
const failures = []
const ignoredPhysicalDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'build',
  'out',
])
const forbiddenFileNames = new Set(['.claude-context.md', '.claude.json'])

for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) failures.push(`missing ${relative}`)
}
function normalize(relative) {
  return relative.split(path.sep).join('/')
}

function isForbiddenPath(relative) {
  const normalized = normalize(relative)
  const parts = normalized.split('/')
  const lowerParts = parts.map((part) => part.toLowerCase())
  const basename = lowerParts.at(-1)

  return (
    forbiddenFileNames.has(basename) ||
    /^claude.*\.md$/.test(basename) ||
    lowerParts.includes('.claude') ||
    lowerParts.some((part, index) => part === '.codex' && lowerParts[index + 1] === 'skills')
  )
}

function physicalPaths(target = root) {
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(target, entry.name)
    const relative = path.relative(root, absolute)
    if (isForbiddenPath(relative)) return [relative]
    if (entry.isDirectory() && !ignoredPhysicalDirectories.has(entry.name)) {
      return physicalPaths(absolute)
    }
    return []
  })
}

for (const relative of physicalPaths()) {
  failures.push(`forbidden physical compatibility path ${normalize(relative)}`)
}

const trackedPaths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
for (const relative of trackedPaths) {
  if (isForbiddenPath(relative)) failures.push(`forbidden tracked compatibility path ${relative}`)
}

function contractFiles(target) {
  if (!fs.existsSync(target)) return []
  const stat = fs.statSync(target)
  if (stat.isFile()) return [target]
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(target, entry.name)
    if (entry.isDirectory()) return contractFiles(absolute)
    return /\.(?:md|toml|yaml|yml|json|ts|tsx|js|mjs|cjs|sh)$/.test(entry.name)
      ? [absolute]
      : []
  })
}

const activeSurfaces = [
  path.join(root, 'AGENTS.md'),
  path.join(root, '.agents'),
  path.join(root, '.github'),
  path.join(root, '.vite-hooks'),
  path.join(root, 'docs'),
  path.join(root, 'package.json'),
  path.join(root, 'README.md'),
  path.join(root, 'DESIGN.md'),
  path.join(root, 'PRODUCT.md'),
  path.join(root, 'src/config'),
  path.join(root, 'scripts'),
  ...fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.(?:md|toml|yaml|yml|json|ts|tsx|js|mjs|cjs|sh)$/.test(entry.name) &&
        (entry.name.startsWith('.') ||
          /(?:^|\.)(?:config|rc)(?:\.|$)|^tsconfig(?:\.|$)/.test(entry.name)),
    )
    .map((entry) => path.join(root, entry.name)),
]
const intentionalReferencePrefixes = [
  'docs/codex-migration/legacy/',
  'docs/history/',
]
const self = path.resolve(import.meta.filename)
for (const file of activeSurfaces.flatMap(contractFiles)) {
  if (path.resolve(file) === self) continue
  const relative = normalize(path.relative(root, file))
  if (intentionalReferencePrefixes.some((prefix) => relative.startsWith(prefix))) continue
  if (
    /CLAUDE.*\.md|\.claude-context\.md|\.claude\.json|\.claude[\\/]|\$ask\s+claude|claude-code-runtime/i.test(
      fs.readFileSync(file, 'utf8'),
    )
  ) {
    failures.push(`stale Claude support reference ${relative}`)
  }
}

if (failures.length) {
  console.error(`Codex project contract: FAIL\n- ${failures.join('\n- ')}`)
  if (failures.some((failure) => failure.includes('compatibility path'))) {
    console.error(
      '\nUpstream still maintains the legacy agent-support directory this fork removed, so a' +
        '\nsync can resurrect it. Port whatever changed into the matching .agents/ file, delete' +
        '\nthe reintroduced copy, and keep the merge commit — do not simply re-delete it blind.',
    )
  }
  process.exit(1)
}
console.log('Codex project contract: PASS')
