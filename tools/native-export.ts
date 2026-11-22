import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { readZip } from '../apps/editor/src/zip.ts'

const root = resolve(import.meta.dir, '..')
const shell = join(root, 'tools/native-shell')
const BUILD_TIMEOUT_MS = 240_000
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const SAFE_PATH = /^(?:index\.html|player\.js|game\.json|assets\/[A-Za-z0-9-]{1,64})$/

export const TARGETS = ['bun-windows-x64', 'bun-linux-x64', 'bun-linux-arm64', 'bun-darwin-x64', 'bun-darwin-arm64'] as const

export type NativeResult = { readonly ok: true; readonly bytes: Uint8Array; readonly fileName: string } | { readonly ok: false; readonly error: string }

/**
 * One page with everything inside it: the player, the scene, the scripts and every asset as text. Opening it needs no files and no server.
 */
function inlineHtml(entries: ReadonlyMap<string, Uint8Array>): string | undefined {
	const decoder = new TextDecoder()
	const page = entries.get('index.html')
	const player = entries.get('player.js')
	const gameBytes = entries.get('game.json')
	if (page === undefined || player === undefined || gameBytes === undefined) return undefined
	let game: Record<string, unknown>
	try {
		game = JSON.parse(decoder.decode(gameBytes)) as Record<string, unknown>
	} catch {
		return undefined
	}
	const assetData: Record<string, string> = {}
	for (const [path, data] of entries) if (path.startsWith('assets/')) assetData[path.slice('assets/'.length)] = Buffer.from(data).toString('base64')
	const json = JSON.stringify({ ...game, assetData }).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
	const script = decoder.decode(player).replaceAll('</script', '<\\/script')
	const tag = '<script src="player.js"></script>'
	const html = decoder.decode(page)
	if (!html.includes(tag)) return undefined
	return html.replace(tag, () => `<script id="strata-game" type="application/json">${json}</script>\n<script>${script}</script>`)
}

async function compile(args: readonly string[], directory: string): Promise<{ readonly code: number; readonly output: string }> {
	const child = Bun.spawn([process.execPath, ...args], { cwd: directory, stdout: 'pipe', stderr: 'pipe' })
	const timer = setTimeout(() => child.kill(), BUILD_TIMEOUT_MS)
	const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
	clearTimeout(timer)
	return { code, output: `${out}${err}`.trim() }
}

/**
 * Compiles a web export into one executable that opens the game in a native window.
 */
export async function buildNative(archive: Uint8Array, target: string, title = 'Strata game'): Promise<NativeResult> {
	if (!(TARGETS as readonly string[]).includes(target)) return { ok: false, error: 'Unknown target system' }
	if (archive.length > MAX_ARCHIVE_BYTES) return { ok: false, error: 'The game is too large for a native build' }
	if (!existsSync(join(shell, 'node_modules/webview-bun'))) return { ok: false, error: 'Run "bun run native:setup" once to install the window library, then try again' }
	const zip = readZip(archive)
	if (!zip.ok) return { ok: false, error: zip.error.message }
	const entries = new Map<string, Uint8Array>()
	for (const entry of zip.value) {
		if (!SAFE_PATH.test(entry.name)) return { ok: false, error: `Unexpected file in the export: ${entry.name}` }
		entries.set(entry.name, entry.data)
	}
	const html = inlineHtml(entries)
	if (html === undefined) return { ok: false, error: 'The export is incomplete' }
	const directory = join(root, '.cache/native', crypto.randomUUID())
	try {
		await mkdir(directory, { recursive: true })
		await writeFile(join(directory, 'game.html'), html)
		const name = title.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || 'Strata game'
		await writeFile(join(directory, 'entry.ts'), `import html from './game.html' with { type: 'text' }\nimport { start } from ${JSON.stringify(join(shell, 'shell.ts'))}\nstart(html, ${JSON.stringify(name)})\n`)
		const windows = target.includes('windows')
		const outfile = join(directory, windows ? 'game.exe' : 'game')
		const base = ['build', '--compile', `--target=${target}`, `--outfile=${outfile}`]
		let result = await compile([...base, ...(windows ? ['--windows-hide-console'] : []), join(directory, 'entry.ts')], directory)
		if (result.code !== 0 && windows) result = await compile([...base, join(directory, 'entry.ts')], directory)
		if (result.code !== 0) return { ok: false, error: result.output.slice(-1500) || 'The build failed' }
		return { ok: true, bytes: new Uint8Array(await Bun.file(outfile).arrayBuffer()), fileName: windows ? 'game.exe' : 'game' }
	} catch (error: unknown) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) }
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}
