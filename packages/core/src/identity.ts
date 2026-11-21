import { defineComponent } from './component.ts'
import { StrataError } from './errors.ts'
import type { Entity } from './entity.ts'
import { createGuid, isGuid, type Guid } from './guid.ts'
import type { World } from './world.ts'

/**
 * Marks an entity as persistent and gives it a stable id. Entities without it are transient and never saved.
 */
export const Identity = defineComponent('identity', { guid: 'string' }, { guid: '' })

export function assignIdentity(world: World, entity: Entity, guid: Guid = createGuid()): Guid {
	if (!isGuid(guid)) throw new StrataError('invalid-argument', 'Identity needs a valid guid')
	world.add(entity, Identity, { guid })
	return guid
}
