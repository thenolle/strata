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

/** A 3D shape: "cube", "sphere", "plane" or "cylinder", with a color and a base size in units. */
export const Mesh = defineComponent('mesh', { shape: 'string', color: 'string', size: 'f32' }, { shape: 'cube', color: '#5b9dff', size: 100 })

/** Lights the 3D view. A directional light shines along the entity's forward direction; a point light spreads from its position. */
export const Light = defineComponent('light', { kind: 'string', color: 'string', intensity: 'f32', range: 'f32' }, { kind: 'directional', color: '#ffffff', intensity: 1, range: 500 })

/** A 3D camera, shown with a frustum in the editor. */
export const Camera3D = defineComponent('camera3d', { fov: 'f32', near: 'f32', far: 'f32' }, { fov: 60, near: 1, far: 5000 })

export function createSceneRegistry(): ComponentRegistry {
	return new ComponentRegistry()
		.register(Name)
		.register(Transform)
		.register(Parent)
		.register(Sprite)
		.register(Camera)
		.register(Camera)
		.register(Mesh)
		.register(Light)
		.register(Camera3D)
}
