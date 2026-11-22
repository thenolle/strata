import { createGuid, ok, type Guid, type Result } from '@strata/core'
import { Project, guard } from '@strata/project'
import { OpfsStorage } from '@strata/storage-opfs'
import { packProject, unpackProject } from './archive.ts'
import { isSealed, seal, unseal } from './seal.ts'

const OPENED_KEY = 'strata.opened'

export interface ProjectSummary {
	readonly storageName: string
	readonly name: string
	readonly id: Guid
	readonly createdAt: string
	/** When the project was last opened here, in milliseconds, or 0 when it never was. */
	readonly openedAt: number
}

export interface ProjectArchive {
	readonly fileName: string
	readonly bytes: Uint8Array
}

export interface StorageInfo {
	readonly usage: number
	readonly quota: number
	readonly persistent: boolean
}

function slug(name: string): string {
	const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
	return base === '' ? 'project' : base
}

function readOpened(): Record<string, number> {
	try {
		const raw = JSON.parse(localStorage.getItem(OPENED_KEY) ?? '{}') as Record<string, unknown>
		const result: Record<string, number> = {}
		for (const [key, value] of Object.entries(raw)) if (typeof value === 'number') result[key] = value
		return result
	} catch {
		return {}
	}
}

function writeOpened(map: Record<string, number>): void {
	try {
		localStorage.setItem(OPENED_KEY, JSON.stringify(map))
	} catch {
		// The order of recent projects is simply not remembered.
	}
}

function markOpened(storageName: string): void {
	writeOpened({ ...readOpened(), [storageName]: Date.now() })
}

function summarize(storageName: string, project: Project): ProjectSummary {
	return { storageName, name: project.name, id: project.id, createdAt: project.createdAt, openedAt: readOpened()[storageName] ?? 0 }
}

/**
 * Every project stored in this browser, most recently opened first. Folders that do not hold a readable project are skipped.
 */
export function listProjects(): Promise<Result<ProjectSummary[]>> {
	return guard<ProjectSummary[]>(async () => {
		const summaries: ProjectSummary[] = []
		for (const storageName of await OpfsStorage.listProjects()) {
			const opened = await Project.open(await OpfsStorage.open(storageName))
			if (opened.ok) summaries.push(summarize(storageName, opened.value))
		}
		summaries.sort((a, b) => b.openedAt - a.openedAt || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
		return ok(summaries)
	})
}

export function createProject(name: string): Promise<Result<Project>> {
	return guard<Project>(async () => {
		const storageName = `${slug(name)}-${createGuid().slice(0, 8)}`
		const created = await Project.create(await OpfsStorage.open(storageName), name)
		if (!created.ok) await OpfsStorage.destroy(storageName)
		else markOpened(storageName)
		return created
	})
}

export function openProject(storageName: string): Promise<Result<Project>> {
	return guard<Project>(async () => {
		const opened = await Project.open(await OpfsStorage.open(storageName))
		if (opened.ok) markOpened(storageName)
		return opened
	})
}

export function deleteProject(storageName: string): Promise<Result<void>> {
	return guard<void>(async () => {
		await OpfsStorage.destroy(storageName)
		const map = readOpened()
		delete map[storageName]
		writeOpened(map)
		return ok(undefined)
	})
}

export function renameProject(storageName: string, name: string): Promise<Result<void>> {
	return guard<void>(async () => {
		const opened = await Project.open(await OpfsStorage.open(storageName))
		if (!opened.ok) return opened
		return opened.value.rename(name)
	})
}

/**
 * Copies a project into a new storage. The copy keeps the original's id, so treat it as a backup or a branch, not as a different game.
 */
export function duplicateProject(storageName: string): Promise<Result<ProjectSummary>> {
	return guard<ProjectSummary>(async () => {
		const source = await Project.open(await OpfsStorage.open(storageName))
		if (!source.ok) return source
		const packed = await packProject(await OpfsStorage.open(storageName))
		if (!packed.ok) return packed
		const target = `${slug(source.value.name)}-${createGuid().slice(0, 8)}`
		const copy = await unpackProject(packed.value, await OpfsStorage.open(target))
		if (!copy.ok) {
			await OpfsStorage.destroy(target)
			return copy
		}
		const renamed = await copy.value.rename(`${source.value.name} copy`.slice(0, 128))
		if (!renamed.ok) {
			await OpfsStorage.destroy(target)
			return renamed
		}
		return ok(summarize(target, copy.value))
	})
}

export function exportProject(storageName: string, password: string): Promise<Result<ProjectArchive>> {
	return guard<ProjectArchive>(async () => {
		const storage = await OpfsStorage.open(storageName)
		const opened = await Project.open(storage)
		if (!opened.ok) return opened
		const packed = await packProject(storage)
		if (!packed.ok) return packed
		return ok({ fileName: `${slug(opened.value.name)}.strata`, bytes: await seal(packed.value, password) })
	})
}

export function importProject(bytes: Uint8Array, password = ''): Promise<Result<ProjectSummary>> {
	return guard<ProjectSummary>(async () => {
		const plain = isSealed(bytes) ? await unseal(bytes, password) : ok(bytes)
		if (!plain.ok) return plain
		const storageName = `import-${createGuid().slice(0, 8)}`
		const imported = await unpackProject(plain.value, await OpfsStorage.open(storageName))
		if (!imported.ok) {
			await OpfsStorage.destroy(storageName)
			return imported
		}
		markOpened(storageName)
		return ok(summarize(storageName, imported.value))
	})
}

/**
 * How much of the browser's storage the projects use, and whether the browser promised not to clear it.
 */
export async function storageInfo(): Promise<StorageInfo | undefined> {
	try {
		const estimate = await navigator.storage.estimate()
		return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persistent: (await navigator.storage.persisted?.()) ?? false }
	} catch {
		return undefined
	}
}

/**
 * Asks the browser to keep this site's storage when space runs low. The browser may refuse.
 */
export async function protectStorage(): Promise<boolean> {
	try {
		return (await navigator.storage.persist?.()) ?? false
	} catch {
		return false
	}
}
