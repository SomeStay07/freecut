import { copyFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sidecarRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const targetTriple = execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim()
const locator = process.platform === 'win32' ? 'where.exe' : 'which'
const uvPath = execFileSync(locator, ['uv'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .map((value) => value.trim())
  .find(Boolean)

if (!uvPath) {
  throw new Error('uv is required to prepare the bundled runtime manager')
}

const extension = process.platform === 'win32' ? '.exe' : ''
const destination = resolve(sidecarRoot, 'src-tauri', 'binaries', `uv-${targetTriple}${extension}`)
await mkdir(dirname(destination), { recursive: true })
await copyFile(uvPath, destination)

process.stdout.write(`Prepared uv sidecar for ${targetTriple}\n`)
