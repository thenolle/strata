import { resolve } from 'node:path'

interface Finding {
	readonly file: string
	readonly message: string
}

const ALLOWED_DEV = new Set(['typescript', '@types/bun', '@webgpu/types'])
const ALLOWED_RUNTIME = [/^@gambrel\//, /^@strata\//]
const ALLOWED_IMPORTS = [/^bun$/, /^bun:/, /^node:/, /^@gambrel\//, /^@strata\//]
const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const
const IMPORT_PATTERN = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g
const root = resolve(import.meta.dir, '..')

async function readManifest(path: string): Promise<Record<string, unknown>> {
	return (await Bun.file(path).json()) as Record<string, unknown>
}

function entries(value: unknown): [string, string][] {
	return typeof value === 'object' && value !== null ? Object.entries(value as Record<string, string>) : []
}

function isExact(version: string): boolean {
	return version.startsWith('workspace:') || /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)
}

async function auditManifest(path: string, findings: Finding[]): Promise<void> {
	const manifest = await readManifest(path)
	for (const [name, version] of entries(manifest['devDependencies'])) {
		if (!ALLOWED_DEV.has(name)) findings.push({ file: path, message: `devDependency "${name}" is not approved` })
		if (!isExact(version)) findings.push({ file: path, message: `"${name}" must use an exact version, found "${version}"` })
	}
	for (const field of DEPENDENCY_FIELDS) {
		for (const [name, version] of entries(manifest[field])) {
			if (!ALLOWED_RUNTIME.some((pattern) => pattern.test(name))) findings.push({ file: path, message: `${field} "${name}" is not approved` })
			if (!isExact(version)) findings.push({ file: path, message: `"${name}" must use an exact version, found "${version}"` })
		}
	}
}

async function auditSources(findings: Finding[]): Promise<void> {
	const glob = new Bun.Glob('{packages,apps,tools}/**/*.{ts,tsx,mts,js,mjs}')
	for await (const relative of glob.scan({ cwd: root })) {
		const normalized = relative.replaceAll('\\', '/')
		if (normalized === 'tools/audit-deps.ts' || normalized.includes('/node_modules/') || normalized.includes('/dist/')) continue
		const source = await Bun.file(resolve(root, relative)).text()
		for (const match of source.matchAll(IMPORT_PATTERN)) {
			const specifier = match[1] ?? ''
			if (specifier.startsWith('.') || specifier.startsWith('/')) continue
			if (!ALLOWED_IMPORTS.some((pattern) => pattern.test(specifier))) findings.push({ file: normalized, message: `import "${specifier}" is not an approved dependency` })
		}
	}
}

async function main(): Promise<void> {
	const findings: Finding[] = []
	const manifests = ['package.json']
	for await (const relative of new Bun.Glob('{packages,apps}/*/package.json').scan({ cwd: root })) manifests.push(relative)
	for (const manifest of manifests) await auditManifest(resolve(root, manifest), findings)
	await auditSources(findings)
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
