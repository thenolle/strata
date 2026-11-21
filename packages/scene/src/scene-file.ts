import { MigrationChain, createEnvelope, ok, parseEnvelope, restoreWorld, snapshotWorld, stringifyEnvelope, type ComponentRegistry, type Entity, type Guid, type Result, type World } from '@strata/core'

export const SCENE_KIND = 'strata.scene'
export const SCENE_FORMAT_VERSION = 1

const migrations = new MigrationChain(SCENE_KIND, SCENE_FORMAT_VERSION, [])

/**
 * Serializes every persistent entity to a versioned, diff-friendly JSON document.
 */
export function saveScene(world: World, registry: ComponentRegistry): Result<string> {
	const snapshot = snapshotWorld(world, registry)
	if (!snapshot.ok) return snapshot
	return ok(stringifyEnvelope(createEnvelope(SCENE_KIND, SCENE_FORMAT_VERSION, snapshot.value)))
}

/**
 * Loads a scene document into a world, upgrading older versions. Returns the stable id to entity mapping.
 */
export function loadScene(world: World, registry: ComponentRegistry, text: string): Result<ReadonlyMap<Guid, Entity>> {
	const parsed = parseEnvelope(text, SCENE_KIND)
	if (!parsed.ok) return parsed
	const upgraded = migrations.upgrade(parsed.value)
	if (!upgraded.ok) return upgraded
	return restoreWorld(world, registry, upgraded.value.data)
}
