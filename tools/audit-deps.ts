import { resolve } from 'node:path'

type Platform = 'browser' | 'server' | 'universal'

interface Finding {
	readonly file: string
	readonly message: string
}

interface Workspace {
	readonly name: string
	readonly directory: string
	readonly platform: Platform
}

const PLATFORMS: readonly Platform[] = ['browser', 'server', 'universal']
const ALLOWED_DEV = new Set(['typescript', '@types/bun', '@webgpu/types'])
const ALLOWED_RUNTIME = [/^@gambrel\//, /^@strata\//]
const ALLOWED_IMPORTS = [/^bun$/, /^bun:/, /^node:/, /^@gambrel\//]
const SERVER_ONLY = [/^bun$/, /^bun:/, /^node:/, /^@gambrel\/(core|bun|ssr|compiler)$/, /\.server(\.[cm]?[jt]sx?)?$/]
const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const
const IMPORT_PATTERN = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g
const root = resolve(import.meta.dir, '..')

function normalize(path: string): string {
	return path.replaceAll('\\', '/')
}

async function readManifest(path: string): Promise<Record<string, unknown>> {
	return (await Bun.file(path).json()) as Record<string, unknown>
}

function entries(value: unknown): [string, string][] {
	return typeof value === 'object' && value !== null ? Object.entries(value as Record<string, string>) : []
}

function isExact(version: string): boolean {
	return version.startsWith('workspace:') || /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)
}

function readPlatform(manifest: Record<string, unknown>): Platform | undefined {
	const strata = manifest['strata']
	if (typeof strata !== 'object' || strata === null) return undefined
	const value = (strata as Record<string, unknown>)['platform']
	return PLATFORMS.find((platform) => platform === value)
}

function violates(source: Platform, target: Platform): boolean {
	if (source === 'server') return false
	if (source === 'browser') return target === 'server'
	return target !== 'universal'
}

async function manifestPaths(): Promise<string[]> {
	const paths: string[] = []
	for await (const relative of new Bun.Glob('{packages,apps}/*/package.json').scan({ cwd: root })) paths.push(normalize(relative))
	return paths.sort()
}

async function auditManifest(file: string, findings: Finding[]): Promise<void> {
	const manifest = await readManifest(resolve(root, file))
	for (const [name, version] of entries(manifest['devDependencies'])) {
		if (!ALLOWED_DEV.has(name)) findings.push({ file, message: `devDependency "${name}" is not approved` })
		if (!isExact(version)) findings.push({ file, message: `"${name}" must use an exact version, found "${version}"` })
	}
	for (const field of DEPENDENCY_FIELDS) {
		for (const [name, version] of entries(manifest[field])) {
			if (!ALLOWED_RUNTIME.some((pattern) => pattern.test(name))) findings.push({ file, message: `${field} "${name}" is not approved` })
			if (!isExact(version)) findings.push({ file, message: `"${name}" must use an exact version, found "${version}"` })
		}
	}
}

async function loadWorkspaces(paths: readonly string[], findings: Finding[]): Promise<Workspace[]> {
	const workspaces: Workspace[] = []
	for (const file of paths) {
		const manifest = await readManifest(resolve(root, file))
		const name = typeof manifest['name'] === 'string' ? manifest['name'] : ''
		const platform = readPlatform(manifest)
		if (name === '') findings.push({ file, message: 'package name is missing' })
		if (platform === undefined) findings.push({ file, message: 'strata.platform must be "browser", "server" or "universal"' })
		if (name !== '' && platform !== undefined) workspaces.push({ name, directory: file.slice(0, file.lastIndexOf('/')), platform })
	}
	return workspaces
}

function auditSpecifier(file: string, platform: Platform, specifier: string, workspaces: readonly Workspace[], findings: Finding[]): void {
	if (platform !== 'server' && SERVER_ONLY.some((pattern) => pattern.test(specifier))) {
		findings.push({ file, message: `${platform} code cannot use server-only module "${specifier}"` })
		return
	}
	if (specifier.startsWith('.') || specifier.startsWith('/')) return
	if (specifier.startsWith('@strata/')) {
		const name = specifier.split('/').slice(0, 2).join('/')
		const target = workspaces.find((workspace) => workspace.name === name)
		if (target === undefined) findings.push({ file, message: `dependency "${specifier}" does not match a workspace package` })
		else if (violates(platform, target.platform)) findings.push({ file, message: `${platform} code cannot depend on ${target.platform} package "${name}"` })
		return
	}
	if (!ALLOWED_IMPORTS.some((pattern) => pattern.test(specifier))) findings.push({ file, message: `dependency "${specifier}" is not approved` })
}

async function auditSources(workspaces: readonly Workspace[], findings: Finding[]): Promise<void> {
	const glob = new Bun.Glob('{packages,apps,tools}/**/*.{ts,tsx,mts,js,mjs}')
	for await (const raw of glob.scan({ cwd: root })) {
		const file = normalize(raw)
		if (file.includes('node_modules/') || file.includes('/dist/')) continue
		const owner = workspaces.find((workspace) => file.startsWith(`${workspace.directory}/`))
		const platform: Platform = owner?.platform ?? 'server'
		const source = await Bun.file(resolve(root, file)).text()
		for (const match of source.matchAll(IMPORT_PATTERN)) auditSpecifier(file, platform, match[1] ?? '', workspaces, findings)
	}
}

async function main(): Promise<void> {
	const findings: Finding[] = []
	const paths = await manifestPaths()
	await auditManifest('package.json', findings)
	for (const file of paths) await auditManifest(file, findings)
	const workspaces = await loadWorkspaces(paths, findings)
	await auditSources(workspaces, findings)
	if (!(await Bun.file(resolve(root, 'bun.lock')).exists())) findings.push({ file: 'bun.lock', message: 'lockfile is missing' })
	if (findings.length === 0) {
		console.log('Dependency audit passed.')
		return
	}
	for (const finding of findings) console.error(`${finding.file}  ${finding.message}`)
	console.error(`\nDependency audit failed with ${findings.length} finding(s).`)
	process.exitCode = 1
}

await main()
