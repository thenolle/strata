import type { Entity } from '@strata/core'
import type { EditorSession } from '@strata/editor-core'
import type { Project } from '@strata/project'

export type SceneType = '2d' | '3d'

const THREE_D = ['mesh', 'light', 'camera3d', 'environment']
const GLYPHS: readonly (readonly [string, string])[] = [['mesh', '▣'], ['light', '✺'], ['camera3d', '◉'], ['environment', '☁'], ['sprite', '▨'], ['camera', '◉'], ['collider', '▢']]
const THREE_D_ONLY: readonly string[] = ['mesh', 'light', 'camera3d', 'environment']
const TWO_D_ONLY: readonly string[] = ['sprite', 'collider', 'camera']

export function parseSceneTypes(value: unknown): Record<string, SceneType> {
	const out: Record<string, SceneType> = {}
	if (typeof value !== 'object' || value === null) return out
	for (const [name, type] of Object.entries(value)) if (type === '2d' || type === '3d') out[name] = type
	return out
}

/** 3D when the open scene contains any 3D node, otherwise 2D. */
export function inferSceneType(session: EditorSession): SceneType {
	for (const name of THREE_D) {
		const definition = session.registry.get(name)
		if (definition !== undefined && session.world.query(definition).length > 0) return '3d'
	}
	return '2d'
}

/** A small symbol for what an entity is, shown in the Scene panel. */
export function nodeGlyph(session: EditorSession, entity: Entity): string {
	for (const [name, glyph] of GLYPHS) {
		const definition = session.registry.get(name)
		if (definition !== undefined && session.world.has(entity, definition)) return glyph
	}
	return '○'
}

async function readSettings(project: Project): Promise<Record<string, unknown>> {
	const loaded = await project.loadSettings()
	return loaded.ok && typeof loaded.value === 'object' && loaded.value !== null ? { ...(loaded.value as Record<string, unknown>) } : {}
}

async function patchSettings(project: Project, change: (settings: Record<string, unknown>) => void): Promise<void> {
	const settings = await readSettings(project)
	change(settings)
	await project.saveSettings(settings)
}

export async function sceneTypes(project: Project): Promise<Record<string, SceneType>> {
	return parseSceneTypes((await readSettings(project))['sceneTypes'])
}

/** The saved type of the open scene, or the one its contents suggest. */
export async function sceneTypeOf(session: EditorSession): Promise<SceneType> {
	return (await sceneTypes(session.project))[session.scene] ?? inferSceneType(session)
}

export async function setSceneType(project: Project, scene: string, type: SceneType): Promise<void> {
	await patchSettings(project, (settings) => {
		settings['sceneTypes'] = { ...parseSceneTypes(settings['sceneTypes']), [scene]: type }
	})
}

export async function renameSceneType(project: Project, from: string, to: string): Promise<void> {
	await patchSettings(project, (settings) => {
		const types = parseSceneTypes(settings['sceneTypes'])
		const type = types[from]
		if (type === undefined) return
		delete types[from]
		settings['sceneTypes'] = { ...types, [to]: type }
	})
}

export async function rememberScene(project: Project, scene: string): Promise<void> {
	await patchSettings(project, (settings) => {
		settings['lastScene'] = scene
	})
}

export async function lastSceneOf(project: Project): Promise<string | undefined> {
	const value = (await readSettings(project))['lastScene']
	return typeof value === 'string' ? value : undefined
}

/** Whether a component belongs in a scene of this type. */
export const allowedIn = (type: SceneType, component: string): boolean => (type === '3d' ? !TWO_D_ONLY.includes(component) : !THREE_D_ONLY.includes(component))
