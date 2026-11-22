import { MigrationChain, StrataError, createEnvelope, createGuid, err, isGuid, ok, parseEnvelope, stringifyEnvelope, type Guid, type Result } from '@strata/core'
import { AssetLibrary } from './assets.ts'
import { guard } from './storage-error.ts'
import type { ProjectStorage } from './storage.ts'

export const PROJECT_KIND = 'strata.project'
export const PROJECT_FORMAT_VERSION = 1

const PROJECT_PATH = 'project.json'
const SETTINGS_PATH = 'settings.json'
const SCENE_DIR = 'scenes'
const SCENE_SUFFIX = '.scene.json'
const SCENE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/
const migrations = new MigrationChain(PROJECT_KIND, PROJECT_FORMAT_VERSION, [])

function cleanProjectName(raw: string): string | undefined {
	const name = raw.trim()
	return name.length >= 1 && name.length <= 128 && !/[\x00-\x1f]/.test(name) ? name : undefined
}

function scenePath(name: string): Result<string> {
	return SCENE_NAME.test(name) ? ok(`${SCENE_DIR}/${name}${SCENE_SUFFIX}`) : err(new StrataError('invalid-argument', 'Scene names are 1 to 64 letters, digits, spaces, underscores or hyphens'))
}

/**
 * A project: identity and name, its assets, and its scenes, stored through any ProjectStorage.
 * Scenes are stored as text and are opaque to the project.
 */
export class Project {
	readonly id: Guid
	readonly createdAt: string
	readonly assets: AssetLibrary
	readonly #storage: ProjectStorage
	#name: string

	private constructor(storage: ProjectStorage, id: Guid, name: string, createdAt: string, assets: AssetLibrary) {
		this.#storage = storage
		this.id = id
		this.#name = name
		this.createdAt = createdAt
		this.assets = assets
	}

	get name(): string {
		return this.#name
	}

	static async exists(storage: ProjectStorage): Promise<boolean> {
		return (await storage.read(PROJECT_PATH)) !== undefined
	}

	static create(storage: ProjectStorage, name: string): Promise<Result<Project>> {
		return guard<Project>(async () => {
			const clean = cleanProjectName(name)
			if (clean === undefined) return err(new StrataError('invalid-argument', 'Project names are 1 to 128 characters'))
			if (await Project.exists(storage)) return err(new StrataError('conflict', 'A project already exists in this storage'))
			const assets = await AssetLibrary.open(storage)
			if (!assets.ok) return assets
			const project = new Project(storage, createGuid(), clean, new Date().toISOString(), assets.value)
			await project.#writeMeta()
			return ok(project)
		})
	}

	static open(storage: ProjectStorage): Promise<Result<Project>> {
		return guard<Project>(async () => {
			const bytes = await storage.read(PROJECT_PATH)
			if (bytes === undefined) return err(new StrataError('not-found', 'No project found in this storage'))
			const parsed = parseEnvelope(new TextDecoder().decode(bytes), PROJECT_KIND)
			if (!parsed.ok) return parsed
			const upgraded = migrations.upgrade(parsed.value)
			if (!upgraded.ok) return upgraded
			const data = upgraded.value.data as Record<string, unknown> | null
			const id = data?.['id']
			const name = data?.['name']
			const createdAt = data?.['createdAt']
			if (!isGuid(id) || typeof name !== 'string' || cleanProjectName(name) === undefined || typeof createdAt !== 'string') return err(new StrataError('corrupt', 'Project file is malformed'))
			const assets = await AssetLibrary.open(storage)
			if (!assets.ok) return assets
			return ok(new Project(storage, id, name, createdAt, assets.value))
		})
	}

	rename(name: string): Promise<Result<void>> {
		return guard<void>(async () => {
			const clean = cleanProjectName(name)
			if (clean === undefined) return err(new StrataError('invalid-argument', 'Project names are 1 to 128 characters'))
			this.#name = clean
			await this.#writeMeta()
			return ok(undefined)
		})
	}

	saveScene(name: string, text: string): Promise<Result<void>> {
		return guard<void>(async () => {
			const path = scenePath(name)
			if (!path.ok) return path
			await this.#storage.write(path.value, new TextEncoder().encode(text))
			return ok(undefined)
		})
	}

	loadScene(name: string): Promise<Result<string>> {
		return guard<string>(async () => {
			const path = scenePath(name)
			if (!path.ok) return path
			const bytes = await this.#storage.read(path.value)
			return bytes === undefined ? err(new StrataError('not-found', `No scene named "${name}"`)) : ok(new TextDecoder().decode(bytes))
		})
	}

	deleteScene(name: string): Promise<Result<boolean>> {
		return guard<boolean>(async () => {
			const path = scenePath(name)
			return path.ok ? ok(await this.#storage.delete(path.value)) : path
		})
	}

	listScenes(): Promise<Result<string[]>> {
		return guard<string[]>(async () => {
			const files = await this.#storage.list(SCENE_DIR)
			return ok(files.filter((file) => file.endsWith(SCENE_SUFFIX)).map((file) => file.slice(SCENE_DIR.length + 1, -SCENE_SUFFIX.length)))
		})
	}

	async #writeMeta(): Promise<void> {
		const text = stringifyEnvelope(createEnvelope(PROJECT_KIND, PROJECT_FORMAT_VERSION, { id: this.id, name: this.#name, createdAt: this.createdAt }))
		await this.#storage.write(PROJECT_PATH, new TextEncoder().encode(text))
	}

	/** The project's saved settings, or undefined when none were saved. */
	loadSettings(): Promise<Result<unknown>> {
		return guard<unknown>(async () => {
			const bytes = await this.#storage.read(SETTINGS_PATH)
			if (bytes === undefined) return ok(undefined)
			try {
				return ok(JSON.parse(new TextDecoder().decode(bytes)) as unknown)
			} catch {
				return err(new StrataError('corrupt', 'The project settings are damaged'))
			}
		})
	}

	saveSettings(value: unknown): Promise<Result<void>> {
		return guard<void>(async () => {
			const text = JSON.stringify(value)
			if (text.length > 64 * 1024) return err(new StrataError('invalid-argument', 'The settings are too large'))
			await this.#storage.write(SETTINGS_PATH, new TextEncoder().encode(text))
			return ok(undefined)
		})
	}
}
