import { ComponentRegistry, defineComponent, type ComponentData, type Entity } from '@strata/core'

/**
 * Local position, unit rotation quaternion and scale relative to the parent, or to the world without one.
 */
export const Transform = defineComponent(
	'transform',
	{ x: 'f32', y: 'f32', z: 'f32', qx: 'f32', qy: 'f32', qz: 'f32', qw: 'f32', sx: 'f32', sy: 'f32', sz: 'f32' },
	{ x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, sx: 1, sy: 1, sz: 1 }
)

/**
 * Attaches an entity to a parent. Manage it through `TransformSystem.setParent`, which rejects cycles.
 */
export const Parent = defineComponent('parent', { parent: 'entity' }, { parent: 0 as Entity })

/**
 * Human-readable entity name shown in editors.
 */
export const Name = defineComponent('name', { value: 'string' }, { value: 'Entity' })

/**
 * Draws an image asset, referenced by its id. An empty string means no image.
 */
export const Sprite = defineComponent('sprite', { asset: 'string' }, { asset: '' })

/**
 * Marks the view through which the scene is shown while playing. Position comes from the entity; `zoom` scales the view.
 */
export const Camera = defineComponent('camera', { zoom: 'f32', follow: 'string', smoothing: 'f32' }, { zoom: 1, follow: '', smoothing: 0 })

export type TransformData = ComponentData<(typeof Transform)['schema']>

export function createSceneRegistry(): ComponentRegistry {
	return new ComponentRegistry()
		.register(Name)
		.register(Transform)
		.register(Parent)
		.register(Sprite)
		.register(Camera)
}
