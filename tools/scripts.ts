import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const scratch = join(root, '.cache/scripts')
const CHECK_TIMEOUT_MS = 20_000
const MAX_FILES = 200
const MAX_TOTAL_BYTES = 2 * 1024 * 1024

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

/**
 * Validates a project script path such as "Enemies/Boss.ts": relative, at most ten parts, no dot segments.
 */
export function cleanScriptPath(raw: unknown): string | undefined {
	if (typeof raw !== 'string' || raw.length === 0 || raw.length > 400 || raw.includes('\0') || raw.includes('\\')) return undefined
	const parts = raw.split('/')
	if (parts.length > 10 || parts.some((part) => part === '' || part === '.' || part === '..')) return undefined
	return raw.toLowerCase().endsWith('.ts') ? raw : undefined
}

/**
 * Bundles a script and the project scripts it imports into one JavaScript module.
 * Only relative imports of other project scripts are allowed. Everything else is refused, so scripts can reach neither packages nor the file system.
 */
export async function bundleScripts(input: unknown): Promise<Compiled> {
	const request = (typeof input === 'object' && input !== null ? input : {}) as { readonly entry?: unknown; readonly files?: unknown }
	const entry = cleanScriptPath(request.entry)
	if (entry === undefined || typeof request.files !== 'object' || request.files === null) return { ok: false, error: 'Invalid bundle request' }
	const files = new Map<string, string>()
	let total = 0
	for (const [path, text] of Object.entries(request.files)) {
		if (cleanScriptPath(path) === undefined || typeof text !== 'string' || text.length === 0 || text.length > MAX_SCRIPT_BYTES) return { ok: false, error: `Invalid script "${path}"` }
		total += text.length
		files.set(path, text)
	}
	if (files.size === 0 || files.size > MAX_FILES || total > MAX_TOTAL_BYTES) return { ok: false, error: 'Too many or too large scripts' }
	if (!files.has(entry)) return { ok: false, error: `Unknown script "${entry}"` }

	const reachable = new Set<string>()
	const queue = [entry]
	while (queue.length > 0) {
		const path = queue.pop() ?? entry
		if (reachable.has(path)) continue
		reachable.add(path)
		let imports: readonly { readonly path: string; readonly kind: string }[]
		try {
			imports = transpiler.scanImports(files.get(path) ?? '')
		} catch (error: unknown) {
			return { ok: false, error: `${path}: ${describe(error)}` }
		}
		let runtime: readonly { readonly path: string }[]
		try {
			runtime = transpiler.scanImports(transpiler.transformSync(files.get(path) ?? ''))
		} catch (error: unknown) {
			return { ok: false, error: `${path}: ${describe(error)}` }
		}
		for (const item of runtime) {
			if (!item.path.startsWith('./') && !item.path.startsWith('../')) return { ok: false, error: `${path}: Scripts can import only other scripts. Use "import type" for types.` }
		}
		for (const item of imports) {
			if (item.kind === 'dynamic-import' || item.kind === 'require-call') return { ok: false, error: `${path}: Scripts cannot load modules dynamically` }
			if (!item.path.startsWith('./') && !item.path.startsWith('../')) continue
			const base = posix.join(posix.dirname(path), item.path)
			const target = [base, `${base}.ts`].find((candidate) => files.has(candidate))
			if (target === undefined) return { ok: false, error: `${path}: cannot find "${item.path}"` }
			queue.push(target)
		}
	}

	const directory = join(scratch, crypto.randomUUID())
	try {
		for (const path of reachable) {
			const disk = join(directory, 'src', path)
			await mkdir(dirname(disk), { recursive: true })
			await writeFile(disk, files.get(path) ?? '')
		}
		const result = await Bun.build({ entrypoints: [join(directory, 'src', entry)], target: 'browser', format: 'esm', minify: false })
		if (!result.success) return { ok: false, error: result.logs.map(String).join('\n') }
		const code = (await result.outputs[0]?.text()) ?? ''
		if (/(^|\n)\s*import\b/.test(code) || /\bimport\s*\(/.test(code)) return { ok: false, error: 'Scripts can import only other scripts. Use "import type" for types.' }
		return { ok: true, code }
	} catch (error: unknown) {
		return { ok: false, error: describe(error) }
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}
