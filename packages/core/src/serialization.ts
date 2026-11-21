import { StrataError } from './errors.ts'
import { err, ok, type Result } from './result.ts'

/**
 * Wrapper around every persisted document: what it is, which format version wrote it, and the payload.
 */
export interface Envelope {
	readonly kind: string
	readonly formatVersion: number
	readonly data: unknown
}

/**
 * Upgrades a payload from version `from` to `from + 1`.
 */
export interface Migration {
	readonly from: number
	migrate(data: unknown): unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isVersion(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

export function createEnvelope(kind: string, formatVersion: number, data: unknown): Envelope {
	if (kind.length === 0) throw new StrataError('invalid-argument', 'Envelope kind must not be empty')
	if (!isVersion(formatVersion)) throw new StrataError('invalid-argument', 'Format version must be a positive integer')
	return { kind, formatVersion, data }
}

/**
 * Serializes with tab indentation so documents diff cleanly in version control.
 */
export function stringifyEnvelope(envelope: Envelope): string {
	return JSON.stringify({ kind: envelope.kind, formatVersion: envelope.formatVersion, data: envelope.data }, null, '\t')
}

/**
 * Parses and validates the envelope shape. The payload itself is not validated here.
 */
export function parseEnvelope(text: string, kind: string): Result<Envelope> {
	let value: unknown
	try { value = JSON.parse(text) } catch (error: unknown) { return err(new StrataError('invalid-format', 'Document is not valid JSON', { cause: error })) }
	if (!isRecord(value)) return err(new StrataError('invalid-format', 'Document must be a JSON object'))
	if (value['kind'] !== kind) return err(new StrataError('invalid-format', `Expected a "${kind}" document`))
	const formatVersion = value['formatVersion']
	if (!isVersion(formatVersion)) return err(new StrataError('invalid-format', 'Document has no valid format version'))
	if (!('data' in value)) return err(new StrataError('invalid-format', 'Document has no data'))
	return ok({ kind, formatVersion, data: value['data'] })
}

/**
 * Ordered migrations that bring any supported older document up to the current version.
 * Documents written by a newer version are rejected rather than guessed at.
 */
export class MigrationChain {
	readonly kind: string
	readonly currentVersion: number
	readonly #migrations = new Map<number, Migration>()

	constructor(kind: string, currentVersion: number, migrations: readonly Migration[]) {
		if (!isVersion(currentVersion)) throw new StrataError('invalid-argument', 'Current version must be a positive integer')
		this.kind = kind
		this.currentVersion = currentVersion
		for (const migration of migrations) {
			if (!isVersion(migration.from) || migration.from >= currentVersion) throw new StrataError('invalid-argument', `Migration from ${migration.from} is outside 1..${currentVersion - 1}`)
			if (this.#migrations.has(migration.from)) throw new StrataError('invalid-argument', `Duplicate migration from ${migration.from}`)
			this.#migrations.set(migration.from, migration)
		}
		for (let version = 1; version < currentVersion; version++) {
			if (!this.#migrations.has(version)) throw new StrataError('invalid-argument', `Missing migration from version ${version}`)
		}
	}

	upgrade(envelope: Envelope): Result<Envelope> {
		if (envelope.kind !== this.kind) return err(new StrataError('invalid-format', `Expected a "${this.kind}" document`))
		if (envelope.formatVersion > this.currentVersion) return err(new StrataError('unsupported-version', `Document version ${envelope.formatVersion} is newer than supported version ${this.currentVersion}`))
		let version = envelope.formatVersion
		let data = envelope.data
		while (version < this.currentVersion) {
			const migration = this.#migrations.get(version)
			if (migration === undefined) return err(new StrataError('unsupported-version', `No migration from version ${version}`))
			try { data = migration.migrate(data) } catch (error: unknown) { return err(new StrataError('invalid-format', `Migration from version ${version} failed`, { cause: error })) }
			version++
		}
		return ok({ kind: this.kind, formatVersion: version, data })
	}
}
