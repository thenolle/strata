import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { readZip } from '../apps/editor/src/zip.ts'

const root = resolve(import.meta.dir, '..')
const BUILD_TIMEOUT_MS = 180_000
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const SAFE_PATH = /^(?:index\.html|player\.js|game\.json|assets\/[A-Za-z0-9-]{1,64})$/

export const TARGETS = ['bun-windows-x64', 'bun-linux-x64', 'bun-linux-arm64', 'bun-darwin-x64', 'bun-darwin-arm64'] as const

export type NativeResult = { readonly ok: true; readonly bytes: Uint8Array; readonly fileName: string } | { readonly ok: false; readonly error: string }

function mimeOf(path: string): string {
	if (path.endsWith('.html')) return 'text/html; charset=utf-8'
	if (path.endsWith('.js')) return 'text/javascript; charset=utf-8'
	if (path.endsWith('.json')) return 'application/json'
	return 'application/octet-stream'
}

/**
 * Compiles a web export into one standalone executable for a target system.
 */
export async function buildNative(archive: Uint8Array, target: string): Promise<NativeResult> {
	if (!(TARGETS as readonly string[]).includes(target)) return { ok: false, error: 'Unknown target system' }
	if (archive.length > MAX_ARCHIVE_BYTES) return { ok: false, error: 'The game is too large for a native build' }
	const zip = readZip(archive)
	if (!zip.ok) return { ok: false, error: zip.error.message }
	if (!zip.value.some((entry) => entry.name === 'index.html')) return { ok: false, error: 'The export has no index.html' }
	const directory = join(root, '.cache/native', crypto.randomUUID())
	try {
		await mkdir(join(directory, 'files'), { recursive: true })
		const entries: { readonly path: string; readonly id: number }[] = []
		for (const entry of zip.value) {
			if (!SAFE_PATH.test(entry.name)) return { ok: false, error: `Unexpected file in the export: ${entry.name}` }
			await writeFile(join(directory, 'files', `${entries.length}.bin`), entry.data)
			entries.push({ path: entry.name, id: entries.length })
		}
		const imports = entries.map((entry) => `import f${entry.id} from './files/${entry.id}.bin' with { type: 'file' }`).join('\n')
		const table = entries.map((entry) => `\t[${JSON.stringify(entry.path)}, { file: f${entry.id}, type: ${JSON.stringify(mimeOf(entry.path))} }]`).join(',\n')
		await writeFile(join(directory, 'entry.ts'), `import { run } from ${JSON.stringify(join(root, 'tools/native-launcher.ts'))}\n${imports}\nvoid run(new Map([\n${table}\n]))\n`)
		const windows = target.includes('windows')
		const outfile = join(directory, windows ? 'game.exe' : 'game')
		const child = Bun.spawn([process.execPath, 'build', '--compile', `--target=${target}`, `--outfile=${outfile}`, join(directory, 'entry.ts')], { cwd: directory, stdout: 'pipe', stderr: 'pipe' })
		const timer = setTimeout(() => child.kill(), BUILD_TIMEOUT_MS)
		const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
		clearTimeout(timer)
		if (code !== 0) return { ok: false, error: `${out}${err}`.trim().slice(-1500) || 'The build failed' }
		return { ok: true, bytes: new Uint8Array(await Bun.file(outfile).arrayBuffer()), fileName: windows ? 'game.exe' : 'game' }
	} catch (error: unknown) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) }
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}
