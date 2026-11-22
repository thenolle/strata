import { defineComponent, type World } from '@strata/core'
import { Body } from '@strata/physics'

/**
 * Moves a body from player input. `mode` is "platformer" (horizontal movement and jumping) or "topdown" (movement on both axes).
 */
export const Controller = defineComponent('controller', { mode: 'string', speed: 'f32', jump: 'f32' }, { mode: 'platformer', speed: 200, jump: 450 })

/**
 * Abstract input, so the controller works with any device and without the browser.
 */
export interface ControllerInput {
	axisX(): number
	axisY(): number
	/** True once per jump request, then false until the next one. */
	consumeJump(): boolean
}

export function updateControllers(world: World, input: ControllerInput): void {
	const x = input.axisX()
	const y = input.axisY()
	const jump = input.consumeJump()
	for (const entity of world.query(Controller, Body)) {
		const controller = world.require(entity, Controller)
		const body = world.require(entity, Body)
		body.vx = x * controller.speed
		if (controller.mode === 'topdown') body.vy = y * controller.speed
		else if (jump && body.grounded > 0) body.vy = controller.jump
	}
}
