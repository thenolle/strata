import { chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeZip } from '../apps/editor/src/zip.ts'
import { buildNative } from './native-export.ts'

const targets: Record<string, string> = { 'win32:x64': 'bun-windows-x64', 'linux:x64': 'bun-linux-x64', 'linux:arm64': 'bun-linux-arm64', 'darwin:x64': 'bun-darwin-x64', 'darwin:arm64': 'bun-darwin-arm64' }
const target = targets[`${process.platform}:${process.arch}`]
if (target === undefined) throw new Error('This system has no native target')
const encoder = new TextEncoder()
const built = await buildNative(writeZip([
	{ name: 'index.html', data: encoder.encode('<!doctype html><title>t</title><script src="player.js"></script>') },
	{ name: 'player.js', data: encoder.encode('console.log(1)') },
	{ name: 'game.json', data: encoder.encode('{"scene":"","assets":[],"scripts":[]}') }
]), target, 'Check')
if (!built.ok) {
	console.log('native failed', built.error)
	process.exit(1)
}
const file = join(tmpdir(), `strata-native-${crypto.randomUUID()}${process.platform === 'win32' ? '.exe' : ''}`)
await Bun.write(file, built.bytes)
if (process.platform !== 'win32') await chmod(file, 0o755)
const child = Bun.spawn([file, '--check'], { stdout: 'pipe', stderr: 'pipe' })
const output = await new Response(child.stdout).text()
await child.exited
await rm(file, { force: true })
console.log('native', target, output.trim())
