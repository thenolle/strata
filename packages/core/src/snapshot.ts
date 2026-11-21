import type { ComponentData, FieldSchema } from './component.ts'
import type { Entity } from './entity.ts'
import { StrataError } from './errors.ts'
import { isGuid, type Guid } from './guid.ts'
import { Identity } from './identity.ts'
import type { ComponentRegistry } from './registry.ts'
import { err, ok, type Result } from './result.ts'
import type { World } from './world.ts'

export interface EntitySnapshot {
	readonly id: Guid
	readonly components: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

export interface WorldSnapshot {
	readonly entities: readonly EntitySnapshot[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string, cause?: unknown): Result<never> {
	return err(new StrataError('invalid-format', message, cause === undefined ? undefined : { cause }))
}

/**
 * Captures every entity that has an identity as plain data. Entity references are written as stable ids.
 * Fails when a persistent entity references a transient or dead one.
 */
export function snapshotWorld(world: World, registry: ComponentRegistry): Result<WorldSnapshot> {
	const ids = new Map<Entity, Guid>()
	const seen = new Set<string>()
	for (const entity of world.query(Identity)) {
		const guid = world.require(entity, Identity).guid
		if (!isGuid(guid)) return invalid(`Entity ${entity} has an invalid identity`)
		if (seen.has(guid)) return invalid(`Identity ${guid} is used by more than one entity`)
		seen.add(guid)
		ids.set(entity, guid)
	}
	const entities: EntitySnapshot[] = []
	for (const [entity, id] of ids) {
		const components: Record<string, Record<string, unknown>> = {}
		for (const definition of registry.definitions()) {
			const data = world.get(entity, definition)
			if (data === undefined) continue
			const out: Record<string, unknown> = {}
			for (const [field, kind] of Object.entries(definition.schema)) {
				const value = data[field]
				if (kind === 'entity') {
					const target = ids.get(value as Entity)
					if (target === undefined) return invalid(`Component "${definition.name}" on ${id} references an entity without identity`)
					out[field] = target
				} else {
					out[field] = value
				}
			}
			components[definition.name] = out
		}
		entities.push({ id, components })
	}
	entities.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
	return ok({ entities })
}

/**
 * Recreates entities from a snapshot, returning the mapping from stable ids to new handles.
 * All or nothing: on any failure every entity created by this call is removed again.
 */
export function restoreWorld(world: World, registry: ComponentRegistry, snapshot: unknown): Result<ReadonlyMap<Guid, Entity>> {
	if (!isRecord(snapshot) || !Array.isArray(snapshot['entities'])) return invalid('Scene data must contain an entities list')
	const taken = new Set<string>()
	for (const entity of world.query(Identity)) taken.add(world.require(entity, Identity).guid)
	const parsed: { id: Guid; components: Record<string, unknown> }[] = []
	for (const raw of snapshot['entities'] as unknown[]) {
		if (!isRecord(raw)) return invalid('Malformed entity entry')
		const id = raw['id']
		const components = raw['components']
		if (!isGuid(id) || !isRecord(components)) return invalid('Malformed entity entry')
		if (taken.has(id)) return invalid(`Identity ${id} already exists`)
		taken.add(id)
		parsed.push({ id, components })
	}
	const ids = new Map<Guid, Entity>()
	const spawned: Entity[] = []
	const rollback = (message: string, cause?: unknown): Result<never> => {
		for (const entity of spawned.reverse()) world.despawn(entity)
		return invalid(message, cause)
	}
	for (const entry of parsed) {
		const entity = world.spawn()
		spawned.push(entity)
		ids.set(entry.id, entity)
		world.add(entity, Identity, { guid: entry.id })
	}
	for (const entry of parsed) {
		const entity = ids.get(entry.id) as Entity
		for (const [name, rawData] of Object.entries(entry.components)) {
			const definition = registry.get(name)
			if (definition === undefined) return rollback(`Unknown component "${name}"`)
			if (!isRecord(rawData)) return rollback(`Component "${name}" on ${entry.id} must be an object`)
			for (const field of Object.keys(rawData)) {
				if (!(field in definition.schema)) return rollback(`Component "${name}" has no field "${field}"`)
			}
			const init: Record<string, unknown> = {}
			for (const [field, kind] of Object.entries(definition.schema)) {
				const value = rawData[field]
				if (value === undefined) continue
				if (kind === 'entity') {
					const target = typeof value === 'string' ? ids.get(value as Guid) : undefined
					if (target === undefined) return rollback(`Component "${name}" on ${entry.id} references unknown entity`)
					init[field] = target
				} else {
					init[field] = value
				}
			}
			try {
				world.add(entity, definition, init as Partial<ComponentData<FieldSchema>>)
			} catch (error: unknown) {
				return rollback(`Component "${name}" on ${entry.id} is invalid`, error)
			}
		}
	}
	return ok(ids)
}
