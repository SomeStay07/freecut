#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const required = [
  'AGENTS.md',
  '.agents/skills/changelog/SKILL.md',
  '.agents/skills/translate-app-locales/SKILL.md',
  '.agents/skills/toolchain-notes/SKILL.md',
  '.agents/skills/render-pipeline-notes/SKILL.md',
]
const forbidden = ['CLAUDE.md', '.claude', '.codex/skills']
const failures = []

for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) failures.push(`missing ${relative}`)
}
for (const relative of forbidden) {
  if (fs.existsSync(path.join(root, relative))) failures.push(`forbidden live compatibility path ${relative}`)
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
  path.join(root, '.vite-hooks'),
  path.join(root, 'package.json'),
  path.join(root, 'src'),
  path.join(root, 'scripts'),
]
const self = path.resolve(import.meta.filename)
for (const file of activeSurfaces.flatMap(contractFiles)) {
  if (path.resolve(file) === self) continue
  if (/CLAUDE\.md|\.claude\/|\$ask\s+claude/i.test(fs.readFileSync(file, 'utf8'))) {
    failures.push(`stale Claude support reference ${path.relative(root, file)}`)
  }
}

if (failures.length) {
  console.error(`Codex project contract: FAIL\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log('Codex project contract: PASS')
