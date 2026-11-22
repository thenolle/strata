import { MigrationChain, StrataError, createEnvelope, createGuid, err, isGuid, ok, parseEnvelope, stringifyEnvelope, type Guid, type Result } from '@strata/core'
import { sha256Hex } from './bytes.ts'
import { hasPngSignature, inspectPng } from './formats/png.ts'
import type { AudioMeta, ImageMeta } from './formats/types.ts'
import { hasWavSignature, inspectWav } from './formats/wav.ts'
import { guard } from './storage-error.ts'
import type { ProjectStorage } from './storage.ts'

export const ASSETS_KIND = 'strata.assets'
export const ASSETS_FORMAT_VERSION = 1
export const MAX_ASSET_BYTES = 256 * 1024 * 1024

const INDEX_PATH = 'assets/index.json'
const BLOB_DIR = 'assets/blobs'
const HASH_PATTERN = /^[0-9a-f]{64}$/
const migrations = new MigrationChain(ASSETS_KIND, ASSETS_FORMAT_VERSION, [])

interface AssetBase {
	readonly id: Guid
	readonly name: string
	readonly hash: string
	readonly size: number
}

export interface ImageAsset extends AssetBase {
	readonly kind: 'image'
	readonly image: ImageMeta
}

export interface AudioAsset extends AssetBase {
	readonly kind: 'audio'
	readonly audio: AudioMeta
}

export const MAX_SCRIPT_BYTES = 256 * 1024

export interface ScriptMeta {
	readonly language: 'typescript'
	readonly lines: number
}

export interface ScriptAsset extends AssetBase {
	readonly kind: 'script'
	readonly script: ScriptMeta
}

export type AssetRecord = ImageAsset | AudioAsset | ScriptAsset
export type AssetKind = AssetRecord['kind']

type Inspection = { readonly kind: 'image'; readonly image: ImageMeta } | { readonly kind: 'audio'; readonly audio: AudioMeta } | { readonly kind: 'script'; readonly script: ScriptMeta }

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function cleanName(raw: string): string | undefined {
	const name = raw.trim()
	return name.length >= 1 && name.length <= 128 && !/[\x00-\x1f/\\]/.test(name) ? name : undefined
}

function compareNames(a: AssetRecord, b: AssetRecord): number {
	const left = a.name.toLowerCase()
	const right = b.name.toLowerCase()
	return left < right ? -1 : left > right ? 1 : 0
}

function blobPath(hash: string): string {
	return `${BLOB_DIR}/${hash}`
}

function inspectScript(bytes: Uint8Array): Result<ScriptMeta> {
	if (bytes.length > MAX_SCRIPT_BYTES) return err(new StrataError('invalid-argument', 'Scripts are at most 256 KB'))
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
		return ok({ language: 'typescript', lines: text.split('\n').length })
	} catch {
		return err(new StrataError('invalid-format', 'Scripts must be UTF-8 text'))
	}
}

function inspectAsset(bytes: Uint8Array, name: string): Result<Inspection> {
	if (name.toLowerCase().endsWith('.ts')) {
		const meta = inspectScript(bytes)
		return meta.ok ? ok({ kind: 'script', script: meta.value }) : meta
	}
	if (hasPngSignature(bytes)) {
		const meta = inspectPng(bytes)
		return meta.ok ? ok({ kind: 'image', image: meta.value }) : meta
	}
	if (hasWavSignature(bytes)) {
		const meta = inspectWav(bytes)
		return meta.ok ? ok({ kind: 'audio', audio: meta.value }) : meta
	}
	return err(new StrataError('invalid-format', 'Unsupported file type; PNG, WAV and TypeScript (.ts) files can be imported'))
}

function parseImageMeta(value: unknown): ImageMeta | undefined {
	if (!isRecord(value)) return undefined
	const width = value['width']
	const height = value['height']
	return isPositiveInteger(width) && isPositiveInteger(height) ? { width, height } : undefined
}

function parseAudioMeta(value: unknown): AudioMeta | undefined {
	if (!isRecord(value)) return undefined
	const sampleRate = value['sampleRate']
	const channels = value['channels']
	const bitsPerSample = value['bitsPerSample']
	const encoding = value['encoding']
	const durationSeconds = value['durationSeconds']
	if (!isPositiveInteger(sampleRate) || !isPositiveInteger(channels) || !isPositiveInteger(bitsPerSample)) return undefined
	if ((encoding !== 'pcm' && encoding !== 'float') || typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds < 0) return undefined
	return { sampleRate, channels, bitsPerSample, encoding, durationSeconds }
}

function parseRecord(raw: unknown): AssetRecord | undefined {
	if (!isRecord(raw)) return undefined
	const id = raw['id']
	const rawName = raw['name']
	const hash = raw['hash']
	const size = raw['size']
	if (!isGuid(id) || typeof rawName !== 'string' || typeof hash !== 'string' || !HASH_PATTERN.test(hash) || !isPositiveInteger(size)) return undefined
	const name = cleanName(rawName)
	if (name === undefined) return undefined
	if (raw['kind'] === 'image') {
		const image = parseImageMeta(raw['image'])
		return image === undefined ? undefined : { id, name, hash, size, kind: 'image', image }
	}
	if (raw['kind'] === 'audio') {
		const audio = parseAudioMeta(raw['audio'])
		return audio === undefined ? undefined : { id, name, hash, size, kind: 'audio', audio }
	}
	if (raw['kind'] === 'script') {
		const meta = raw['script']
		if (!isRecord(meta) || meta['language'] !== 'typescript' || !isPositiveInteger(meta['lines'])) return undefined
		return { id, name, hash, size, kind: 'script', script: { language: 'typescript', lines: meta['lines'] } }
	}
	return undefined
}

function parseRecords(data: unknown): Result<AssetRecord[]> {
	if (!isRecord(data) || !Array.isArray(data['assets'])) return err(new StrataError('corrupt', 'Asset index is malformed'))
	const records: AssetRecord[] = []
	const ids = new Set<string>()
	const names = new Set<string>()
	for (const raw of data['assets'] as unknown[]) {
		const record = parseRecord(raw)
		if (record === undefined) return err(new StrataError('corrupt', 'Asset index contains an invalid record'))
		const key = record.name.toLowerCase()
		if (ids.has(record.id) || names.has(key)) return err(new StrataError('corrupt', `Asset index repeats "${record.name}"`))
		ids.add(record.id)
		names.add(key)
		records.push(record)
	}
	return ok(records)
}

/**
 * The project's imported files. Contents are stored once per unique hash and verified on every read.
 * Mutations run one at a time, and the index is rewritten only after the blob is safely stored.
 */
export class AssetLibrary {
	readonly #storage: ProjectStorage
	#records = new Map<Guid, AssetRecord>()
	#queue: Promise<unknown> = Promise.resolve()

	private constructor(storage: ProjectStorage) {
		this.#storage = storage
	}

	static open(storage: ProjectStorage): Promise<Result<AssetLibrary>> {
		return guard<AssetLibrary>(async () => {
			const library = new AssetLibrary(storage)
			const bytes = await storage.read(INDEX_PATH)
			if (bytes === undefined) return ok(library)
			const parsed = parseEnvelope(new TextDecoder().decode(bytes), ASSETS_KIND)
			if (!parsed.ok) return parsed
			const upgraded = migrations.upgrade(parsed.value)
			if (!upgraded.ok) return upgraded
			const records = parseRecords(upgraded.value.data)
			if (!records.ok) return records
			for (const record of records.value) library.#records.set(record.id, record)
			return ok(library)
		})
	}

	list(): AssetRecord[] {
		return [...this.#records.values()].sort(compareNames)
	}

	get(id: Guid): AssetRecord | undefined {
		return this.#records.get(id)
	}

	find(name: string): AssetRecord | undefined {
		const key = name.trim().toLowerCase()
		return [...this.#records.values()].find((record) => record.name.toLowerCase() === key)
	}

	/**
	 * Validates and stores a PNG or WAV file under a unique name.
	 */
	importAsset(name: string, bytes: Uint8Array): Promise<Result<AssetRecord>> {
		return this.#enqueue(async () => {
			const clean = cleanName(name)
			if (clean === undefined) return err(new StrataError('invalid-argument', 'Asset names must be 1 to 128 characters without slashes or control characters'))
			if (bytes.length === 0 || bytes.length > MAX_ASSET_BYTES) return err(new StrataError('invalid-argument', `Asset size must be 1 byte to ${MAX_ASSET_BYTES} bytes`))
			if (this.find(clean) !== undefined) return err(new StrataError('conflict', `An asset named "${clean}" already exists`))
			const inspected = inspectAsset(bytes, clean)
			if (!inspected.ok) return inspected
			const hash = await sha256Hex(bytes)
			await this.#storage.write(blobPath(hash), bytes)
			const common = { id: createGuid(), name: clean, hash, size: bytes.length }
			const record: AssetRecord = inspected.value.kind === 'image' ? { ...common, kind: 'image', image: inspected.value.image } : inspected.value.kind === 'audio' ? { ...common, kind: 'audio', audio: inspected.value.audio } : { ...common, kind: 'script', script: inspected.value.script }
			await this.#commit(new Map(this.#records).set(record.id, record))
			return ok(record)
		})
	}

	/**
	 * Replaces the text of a script. Other kinds of asset cannot be edited this way.
	 */
	replaceScript(id: Guid, bytes: Uint8Array): Promise<Result<AssetRecord>> {
		return this.#enqueue(async () => {
			const record = this.#records.get(id)
			if (record === undefined) return err(new StrataError('not-found', 'No such asset'))
			if (record.kind !== 'script') return err(new StrataError('invalid-argument', 'Only scripts can be edited'))
			if (bytes.length === 0) return err(new StrataError('invalid-argument', 'A script cannot be empty'))
			const meta = inspectScript(bytes)
			if (!meta.ok) return meta
			const hash = await sha256Hex(bytes)
			await this.#storage.write(blobPath(hash), bytes)
			const updated: ScriptAsset = { ...record, hash, size: bytes.length, script: meta.value }
			const next = new Map(this.#records).set(id, updated)
			await this.#commit(next)
			if (hash !== record.hash && ![...next.values()].some((other) => other.hash === record.hash)) await this.#storage.delete(blobPath(record.hash))
			return ok(updated)
		})
	}

	/**
	 * Returns the stored bytes. With `verify` (the default) the size and hash are checked first.
	 */
	async read(id: Guid, verify = true): Promise<Result<Uint8Array>> {
		return guard<Uint8Array>(async () => {
			const record = this.#records.get(id)
			if (record === undefined) return err(new StrataError('not-found', 'No such asset'))
			const bytes = await this.#storage.read(blobPath(record.hash))
			if (bytes === undefined) return err(new StrataError('corrupt', `The file for "${record.name}" is missing`))
			if (verify && (bytes.length !== record.size || (await sha256Hex(bytes)) !== record.hash)) {
				return err(new StrataError('corrupt', `The file for "${record.name}" does not match its checksum`))
			}
			return ok(bytes)
		})
	}

	rename(id: Guid, name: string): Promise<Result<AssetRecord>> {
		return this.#enqueue(async () => {
			const record = this.#records.get(id)
			if (record === undefined) return err(new StrataError('not-found', 'No such asset'))
			const clean = cleanName(name)
			if (clean === undefined) return err(new StrataError('invalid-argument', 'Asset names must be 1 to 128 characters without slashes or control characters'))
			const clash = this.find(clean)
			if (clash !== undefined && clash.id !== id) return err(new StrataError('conflict', `An asset named "${clean}" already exists`))
			const renamed: AssetRecord = { ...record, name: clean }
			await this.#commit(new Map(this.#records).set(id, renamed))
			return ok(renamed)
		})
	}

	/**
	 * Removes the record, and its stored file when no other asset shares it.
	 */
	remove(id: Guid): Promise<Result<void>> {
		return this.#enqueue(async () => {
			const record = this.#records.get(id)
			if (record === undefined) return err(new StrataError('not-found', 'No such asset'))
			const next = new Map(this.#records)
			next.delete(id)
			await this.#commit(next)
			if (![...next.values()].some((other) => other.hash === record.hash)) await this.#storage.delete(blobPath(record.hash))
			return ok(undefined)
		})
	}

	/**
	 * Deletes stored files that no asset references, such as leftovers from an interrupted import. Returns how many were removed.
	 */
	collectGarbage(): Promise<Result<number>> {
		return this.#enqueue(async () => {
			const referenced = new Set([...this.#records.values()].map((record) => record.hash))
			let removed = 0
			for (const path of await this.#storage.list(BLOB_DIR)) {
				if (referenced.has(path.slice(BLOB_DIR.length + 1))) continue
				if (await this.#storage.delete(path)) removed++
			}
			return ok(removed)
		})
	}

	/**
	 * Reads every asset and lists the problems found. An empty list means the library is intact.
	 */
	async check(): Promise<Result<string[]>> {
		const problems: string[] = []
		for (const record of this.list()) {
			const result = await this.read(record.id)
			if (!result.ok) problems.push(result.error.message)
		}
		return ok(problems)
	}

	#enqueue<T>(task: () => Promise<Result<T>>): Promise<Result<T>> {
		const next = this.#queue.then(() => guard(task))
		this.#queue = next
		return next
	}

	async #commit(next: Map<Guid, AssetRecord>): Promise<void> {
		const assets = [...next.values()].sort(compareNames)
		const text = stringifyEnvelope(createEnvelope(ASSETS_KIND, ASSETS_FORMAT_VERSION, { assets }))
		await this.#storage.write(INDEX_PATH, new TextEncoder().encode(text))
		this.#records = next
	}
}
