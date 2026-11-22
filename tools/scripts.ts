import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const scratch = join(root, '.cache/scripts')
const CHECK_TIMEOUT_MS = 20_000

export const MAX_SCRIPT_BYTES = 256 * 1024

const transpiler = new Bun.Transpiler({ loader: 'ts' })

export type Compiled = { readonly ok: true; readonly code: string } | { readonly ok: false; readonly error: string }

export interface Checked {
	readonly ok: boolean
	readonly output: string
}

function describe(error: unknown): string {
	const nested = (error as { readonly errors?: readonly { readonly message?: unknown }[] } | null)?.errors
	if (Array.isArray(nested) && nested.length > 0) return nested.map((item) => String(item.message)).join('\n')
	return error instanceof Error ? error.message : String(error)
}

/**
 * Turns a TypeScript script into JavaScript. Types are erased, and anything but type imports is refused,
 * because scripts must not load other code.
 */
export function compileScript(source: string): Compiled {
	if (source.length === 0 || source.length > MAX_SCRIPT_BYTES) return { ok: false, error: 'Scripts must be 1 byte to 256 KB' }
	try {
		const code = transpiler.transformSync(source)
		if (/(^|\n)\s*import\b/.test(code) || /\bimport\s*\(/.test(code)) return { ok: false, error: 'Scripts cannot import modules. Use "import type" for types.' }
		return { ok: true, code }
	} catch (error: unknown) {
		return { ok: false, error: describe(error) }
	}
}

/**
 * Type-checks a script with the real TypeScript compiler against the Strata script API, which scripts import as "strata".
 */
export async function checkScript(source: string): Promise<Checked> {
	if (source.length === 0 || source.length > MAX_SCRIPT_BYTES) return { ok: false, output: 'Scripts must be 1 byte to 256 KB' }
	const directory = join(scratch, crypto.randomUUID())
	await mkdir(directory, { recursive: true })
	try {
		await copyFile(join(root, 'packages/scripting/src/api.ts'), join(directory, 'strata.ts'))
		await writeFile(join(directory, 'script.ts'), source)
		await writeFile(
			join(directory, 'tsconfig.json'),
			JSON.stringify({
				compilerOptions: { target: 'ES2022', module: 'esnext', moduleResolution: 'bundler', strict: true, noEmit: true, skipLibCheck: true, noUncheckedIndexedAccess: true, types: [], paths: { strata: ['./strata.ts'] } },
				files: ['script.ts']
			})
		)
		const child = Bun.spawn([process.execPath, 'run', 'tsc', '-p', join(directory, 'tsconfig.json')], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
		const timer = setTimeout(() => child.kill(), CHECK_TIMEOUT_MS)
		const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
		clearTimeout(timer)
		const output = `${out}${err}`.replace(/\.cache[\\/]scripts[\\/][0-9a-f-]+[\\/]/g, '').trim()
		return { ok: code === 0, output: code === 0 ? '' : output }
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}
