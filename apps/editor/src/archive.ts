import { StrataError, err, ok, type Result } from '@strata/core'
import { Project, guard, type ProjectStorage } from '@strata/project'
import { readZip, writeZip, type ZipEntry } from './zip.ts'

/** The only paths a project archive may contain: the files a project is made of. */
const ALLOWED = /^(?:project\.json|assets\/index\.json|settings\.json|assets\/blobs\/[0-9a-f]{64}|scenes\/[A-Za-z0-9][A-Za-z0-9 _-]{0,63}\.scene\.json)$/

/**
 * Reads every file of a project out of its storage.
 */
export async function collectProject(storage: ProjectStorage): Promise<ZipEntry[]> {
	const files: ZipEntry[] = []
	for (const path of ['project.json', 'assets/index.json', 'settings.json']) {
		const data = await storage.read(path)
		if (data !== undefined) files.push({ name: path, data })
	}
	for (const directory of ['assets/blobs', 'scenes']) {
		for (const path of await storage.list(directory)) {
			const data = await storage.read(path)
			if (data !== undefined) files.push({ name: path, data })
		}
	}
	return files
}

/**
 * Packs a project into one archive.
 */
export function packProject(storage: ProjectStorage): Promise<Result<Uint8Array>> {
	return guard<Uint8Array>(async () => {
		const files = await collectProject(storage)
		if (!files.some((file) => file.name === 'project.json')) return err(new StrataError('not-found', 'No project found in this storage'))
		return ok(writeZip(files))
	})
}

/**
 * Restores an archive into an empty storage, then opens it and checks every asset against its recorded hash.
 * The caller should delete the storage when this fails.
 */
export function unpackProject(bytes: Uint8Array, storage: ProjectStorage): Promise<Result<Project>> {
	return guard<Project>(async () => {
		const archive = readZip(bytes)
		if (!archive.ok) return archive
		const seen = new Set<string>()
		for (const file of archive.value) {
			if (!ALLOWED.test(file.name) || seen.has(file.name)) return err(new StrataError('invalid-format', `The archive contains an unexpected file: ${file.name}`))
			seen.add(file.name)
		}
		if (!seen.has('project.json')) return err(new StrataError('invalid-format', 'This archive is not a Strata project'))
		for (const file of archive.value) await storage.write(file.name, file.data)
		const opened = await Project.open(storage)
		if (!opened.ok) return opened
		const problems = await opened.value.assets.check()
		if (!problems.ok) return problems
		if (problems.value.length > 0) return err(new StrataError('corrupt', problems.value[0] ?? 'The archive is damaged'))
		return opened
	})
}
