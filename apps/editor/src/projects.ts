import { createGuid, ok, type Guid, type Result } from '@strata/core'
import { Project, guard } from '@strata/project'
import { OpfsStorage } from '@strata/storage-opfs'

export interface ProjectSummary {
	readonly storageName: string
	readonly name: string
	readonly id: Guid
	readonly createdAt: string
}

function slug(name: string): string {
	const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
	return base === '' ? 'project' : base
}

/**
 * Every project stored in this browser, newest first. Folders that do not hold a readable project are skipped.
 */
export function listProjects(): Promise<Result<ProjectSummary[]>> {
	return guard<ProjectSummary[]>(async () => {
		const summaries: ProjectSummary[] = []
		for (const storageName of await OpfsStorage.listProjects()) {
			const opened = await Project.open(await OpfsStorage.open(storageName))
			if (opened.ok) summaries.push({ storageName, name: opened.value.name, id: opened.value.id, createdAt: opened.value.createdAt })
		}
		summaries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
		return ok(summaries)
	})
}

export function createProject(name: string): Promise<Result<Project>> {
	return guard<Project>(async () => {
		const storageName = `${slug(name)}-${createGuid().slice(0, 8)}`
		const created = await Project.create(await OpfsStorage.open(storageName), name)
		if (!created.ok) await OpfsStorage.destroy(storageName)
		return created
	})
}

export function openProject(storageName: string): Promise<Result<Project>> {
	return guard<Project>(async () => Project.open(await OpfsStorage.open(storageName)))
}

export function deleteProject(storageName: string): Promise<Result<void>> {
	return guard<void>(async () => {
		await OpfsStorage.destroy(storageName)
		return ok(undefined)
	})
}
