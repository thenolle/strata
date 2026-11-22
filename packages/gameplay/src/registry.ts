import type { ComponentRegistry } from '@strata/core'
import { Body, Collider } from '@strata/physics'
import { createSceneRegistry } from '@strata/scene'
import { ScriptSource } from '@strata/scripting'
import { Controller } from './controller.ts'
import { AudioSource } from './audio.ts'

/**
 * Every component a game can contain.
 */
export function createGameRegistry(): ComponentRegistry {
	return createSceneRegistry()
		.register(Body)
		.register(Collider)
		.register(Controller)
		.register(AudioSource)
		.register(ScriptSource)
}
