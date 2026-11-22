import { defineComponent } from '@strata/core'

/**
 * Physical state. `kind` is "dynamic" (moved by forces and collisions), "static" (never moves) or "kinematic" (moved only by its velocity).
 * `grounded` is set to 1 while the body rests on something below it.
 */
export const Body = defineComponent(
	'body',
	{ kind: 'string', vx: 'f32', vy: 'f32', mass: 'f32', restitution: 'f32', friction: 'f32', gravityScale: 'f32', grounded: 'f32' },
	{ kind: 'dynamic', vx: 0, vy: 0, mass: 1, restitution: 0, friction: 0.4, gravityScale: 1, grounded: 0 }
)

/**
 * Collision shape centered on the entity. `shape` is "box" (width and height) or "circle" (radius). The entity's scale is applied.
 */
export const Collider = defineComponent('collider', { shape: 'string', width: 'f32', height: 'f32', radius: 'f32' }, { shape: 'box', width: 32, height: 32, radius: 16 })
