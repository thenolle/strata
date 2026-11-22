import type { ComponentRegistry } from '@strata/core'
import { Body, Collider } from '@strata/physics'
import { createSceneRegistry } from '@strata/scene'
import { Controller } from './controller.ts'

/**
 * Every component a game can contain.
 */
export function createGameRegistry(): ComponentRegistry {
	return createSceneRegistry().register(Body).register(Collider).register(Controller)
}
