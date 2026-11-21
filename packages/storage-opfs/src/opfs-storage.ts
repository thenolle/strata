import { StrataError } from '@strata/core'
import { normalizePath, normalizePrefix, toBuffer, type ProjectStorage } from '@strata/project'

const ROOT_NAME = 'strata-projects'

function isMissing(error: unknown): boolean {
	return error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')
}

function assertSupported(): void {
	if (!('storage' in navigator) || typeof navigator.storage.getDirectory !== 'function') throw new StrataError('unsupported', 'The origin private file system is not available (it needs a secure context)')
	if (!('createWritable' in FileSystemFileHandle.prototype)) throw new StrataError('unsupported', 'This browser cannot write to the origin private file system (Safari needs version 26)')
}

/**
 * Project storage in the browser's origin private file system. Writes replace the file as a unit when the stream closes.
 * Browsers may evict unprotected storage under pressure; call `requestPersistence` after the user starts working.
 */
export class OpfsStorage implements ProjectStorage {
	readonly #root: FileSystemDirectoryHandle

	private constructor(root: FileSystemDirectoryHandle) {
		this.#root = root
	}

	static async open(name: string): Promise<OpfsStorage> {
		if (name.includes('/') || normalizePath(name) !== name) throw new StrataError('invalid-argument', 'Storage names must be a single valid path segment')
		assertSupported()
		const base = await navigator.storage.getDirectory()
		const projects = await base.getDirectoryHandle(ROOT_NAME, { create: true })
		return new OpfsStorage(await projects.getDirectoryHandle(name, { create: true }))
	}

	/**
	 * Names of every stored project, sorted.
	 */
	static async listProjects(): Promise<string[]> {
		assertSupported()
		const base = await navigator.storage.getDirectory()
		let projects: FileSystemDirectoryHandle
		try {
			projects = await base.getDirectoryHandle(ROOT_NAME)
		} catch (error: unknown) {
			if (isMissing(error)) return []
			throw error
		}
		const names: string[] = []
		for await (const [name, handle] of projects.entries()) {
			if (handle.kind === 'directory') names.push(name)
		}
		return names.sort()
	}

	/**
	 * Deletes a stored project and everything in it.
	 */
	static async destroy(name: string): Promise<void> {
		const base = await navigator.storage.getDirectory()
		try {
			const projects = await base.getDirectoryHandle(ROOT_NAME)
			await projects.removeEntry(name, { recursive: true })
		} catch (error: unknown) {
			if (!isMissing(error)) throw error
		}
	}

	/**
	 * Asks the browser to exempt this origin's storage from automatic eviction. Returns whether it was granted.
	 */
	static async requestPersistence(): Promise<boolean> {
		return typeof navigator.storage?.persist === 'function' ? navigator.storage.persist() : false
	}

	async read(path: string): Promise<Uint8Array | undefined> {
		const segments = normalizePath(path).split('/')
		const name = segments.pop() as string
		const directory = await this.#directory(segments, false)
		if (directory === undefined) return undefined
		try {
			const file = await (await directory.getFileHandle(name)).getFile()
			return new Uint8Array(await file.arrayBuffer())
		} catch (error: unknown) {
			if (isMissing(error)) return undefined
			throw error
		}
	}

	async write(path: string, data: Uint8Array): Promise<void> {
		const segments = normalizePath(path).split('/')
		const name = segments.pop() as string
		const directory = (await this.#directory(segments, true)) as FileSystemDirectoryHandle
		const handle = await directory.getFileHandle(name, { create: true })
		const writable = await handle.createWritable()
		try {
			await writable.write(toBuffer(data))
			await writable.close()
		} catch (error: unknown) {
			await writable.abort().catch(() => undefined)
			throw error
		}
	}

	async delete(path: string): Promise<boolean> {
		const segments = normalizePath(path).split('/')
		const name = segments.pop() as string
		const directory = await this.#directory(segments, false)
		if (directory === undefined) return false
		try {
			await directory.removeEntry(name)
			return true
		} catch (error: unknown) {
			if (isMissing(error)) return false
			throw error
		}
	}

	async list(prefix: string): Promise<string[]> {
		const base = normalizePrefix(prefix)
		const segments = base === '' ? [] : base.split('/')
		const directory = await this.#directory(segments, false)
		if (directory === undefined) return []
		const files: string[] = []
		await this.#walk(directory, base, files)
		return files.sort()
	}

	async #directory(segments: readonly string[], create: boolean): Promise<FileSystemDirectoryHandle | undefined> {
		let current = this.#root
		for (const segment of segments) {
			try {
				current = await current.getDirectoryHandle(segment, { create })
			} catch (error: unknown) {
				if (!create && isMissing(error)) return undefined
				throw error
			}
		}
		return current
	}

	async #walk(directory: FileSystemDirectoryHandle, path: string, files: string[]): Promise<void> {
		for await (const [name, handle] of directory.entries()) {
			const full = path === '' ? name : `${path}/${name}`
			if (handle.kind === 'directory') await this.#walk(handle as FileSystemDirectoryHandle, full, files)
			else files.push(full)
		}
	}
}
