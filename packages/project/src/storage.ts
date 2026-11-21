import { normalizePath, normalizePrefix } from './path.ts'

/**
 * Where a project's files live. Paths are project-relative with forward slashes and are validated by every implementation.
 */
export interface ProjectStorage {
	read(path: string): Promise<Uint8Array | undefined>
	/**
	 * Replaces the file as a unit; readers never observe a partial write.
	 */
	write(path: string, data: Uint8Array): Promise<void>
	delete(path: string): Promise<boolean>
	/**
	 * Every file under the directory prefix, recursively, sorted. The empty prefix lists the whole project.
	 */
	list(prefix: string): Promise<string[]>
}

/**
 * Volatile storage for tests, tooling and previews.
 */
export class MemoryStorage implements ProjectStorage {
	readonly #files = new Map<string, Uint8Array>()

	async read(path: string): Promise<Uint8Array | undefined> {
		return this.#files.get(normalizePath(path))?.slice()
	}

	async write(path: string, data: Uint8Array): Promise<void> {
		this.#files.set(normalizePath(path), data.slice())
	}

	async delete(path: string): Promise<boolean> {
		return this.#files.delete(normalizePath(path))
	}

	async list(prefix: string): Promise<string[]> {
		const base = normalizePrefix(prefix)
		const start = base === '' ? '' : `${base}/`
		return [...this.#files.keys()].filter((path) => path.startsWith(start)).sort()
	}
}
