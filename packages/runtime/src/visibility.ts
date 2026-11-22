import type { Entity, World } from '@strata/core'
import { Collider } from '@strata/physics'
import { Camera, Sprite } from '@strata/scene'

/**
 * A camera on its own is invisible. An entity that also has a sprite or a collider is still drawn.
 */
export function isDrawable(world: World, entity: Entity): boolean {
	return !world.has(entity, Camera) || world.has(entity, Sprite) || world.has(entity, Collider)
}
