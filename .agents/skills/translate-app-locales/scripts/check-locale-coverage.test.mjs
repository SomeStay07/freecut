import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./check-locale-coverage.mjs', import.meta.url))

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function runCoverage(root) {
  return spawnSync(
    process.execPath,
    [
      script,
      '--locales',
      path.join(root, 'locales'),
      '--partials',
      path.join(root, 'locales', 'partials'),
      '--source',
      'en',
      '--target',
      'tr',
    ],
    { encoding: 'utf8' },
  )
}

test('checks language-directory partials and reports missing target keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-coverage-'))
  try {
    writeJson(path.join(root, 'locales/en.json'), { common: { save: 'Save' } })
    writeJson(path.join(root, 'locales/tr.json'), { common: { save: 'Kaydet' } })
    writeJson(path.join(root, 'locales/partials/en/editor.json'), {
      editor: { play: 'Play', pause: 'Pause' },
    })
    writeJson(path.join(root, 'locales/partials/tr/editor.json'), {
      editor: { play: 'Oynat' },
    })

    const incomplete = runCoverage(root)
    assert.equal(incomplete.status, 1)
    assert.match(incomplete.stdout, /partial editor\.json tr: 1\/2/)
    assert.match(incomplete.stdout, /editor\.pause/)
    assert.match(incomplete.stderr, /Missing 1 target translation keys/)

    writeJson(path.join(root, 'locales/partials/tr/editor.json'), {
      editor: { play: 'Oynat', pause: 'Duraklat' },
    })
    const complete = runCoverage(root)
    assert.equal(complete.status, 0, complete.stderr)
    assert.match(complete.stdout, /partial editor\.json tr: 2\/2/)
    assert.match(complete.stdout, /Locale coverage complete/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
