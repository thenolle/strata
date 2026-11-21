import { Emitter, Identity, Logger, StrataError, World, assignIdentity, nullSink, ok, type Disposable, type Entity, type Guid, type Result } from '@strata/core'
import { Vec3, degToRad, radToDeg, trig, wrapAngle } from '@strata/math'
import type { Project } from '@strata/project'
import { Name, Parent, Transform, TransformSystem, createSceneRegistry, loadScene, saveScene, type TransformData } from '@strata/scene'

export const MAIN_SCENE = 'main'
const MAX_NAME_LENGTH = 128

export type ChangeKind = 'structure' | 'selection' | 'name' | 'transform' | 'saved'

export interface EntityRow {
	readonly entity: Entity
	readonly id: Guid
	readonly name: string
	readonly depth: number
}

export interface CreateEntityOptions {
	readonly name?: string
	readonly parent?: Entity
	readonly x?: number
	readonly y?: number
	readonly select?: boolean
}

/**
 * The state of one open project in an editor: its world, transforms, selection and unsaved-change tracking.
 * It has no UI. Every mutation announces what kind of change it was.
 */
export class EditorSession implements Disposable {
	readonly project: Project
	readonly world = new World()
	readonly registry = createSceneRegistry()
	readonly transforms: TransformSystem
	readonly changed = new Emitter<ChangeKind>()
	readonly #logger: Logger
	readonly #scratch = new Vec3()
	#selection: Entity | undefined
	#dirty = false
	#rows: readonly EntityRow[] | undefined

	private constructor(project: Project, logger: Logger) {
		this.project = project
		this.#logger = logger
		this.transforms = new TransformSystem(this.world, logger.child('transforms'))
	}

	/**
	 * Opens a session and loads the project's main scene when it exists.
	 */
	static async open(project: Project, logger: Logger = new Logger(nullSink, 'editor')): Promise<Result<EditorSession>> {
		const session = new EditorSession(project, logger)
		const text = await project.loadScene(MAIN_SCENE)
		if (text.ok) {
			const loaded = loadScene(session.world, session.registry, text.value)
			if (!loaded.ok) {
				session.dispose()
				return loaded
			}
			session.transforms.update()
		} else if (text.error.code !== 'not-found') {
			session.dispose()
			return text
		}
		return ok(session)
	}

	get selection(): Entity | undefined {
		return this.#selection
	}

	get dirty(): boolean {
		return this.#dirty
	}

	update(): void {
		this.transforms.update()
	}

	select(entity: Entity | undefined): void {
		const next = entity !== undefined && this.#isPersistent(entity) ? entity : undefined
		if (next === this.#selection) return
		this.#selection = next
		this.#announce('selection')
	}

	createEntity(options: CreateEntityOptions = {}): Entity {
		const entity = this.world.spawn()
		assignIdentity(this.world, entity)
		this.world.add(entity, Name, { value: options.name ?? `Entity ${this.world.query(Identity).length}` })
		this.world.add(entity, Transform, { x: options.x ?? 0, y: options.y ?? 0 })
		if (options.parent !== undefined && this.#isPersistent(options.parent)) this.transforms.setParent(entity, options.parent)
		if (options.select !== false) this.#selection = entity
		this.#touch('structure')
		return entity
	}

	/**
	 * Removes an entity and all of its descendants. Returns how many entities were removed.
	 */
	deleteEntity(entity: Entity): number {
		if (!this.#isPersistent(entity)) return 0
		const removed = this.transforms.despawnTree(entity)
		if (this.#selection !== undefined && !this.#isPersistent(this.#selection)) this.#selection = undefined
		this.#touch('structure')
		return removed
	}

	deleteSelected(): number {
		return this.#selection === undefined ? 0 : this.deleteEntity(this.#selection)
	}

	nameOf(entity: Entity): string {
		return this.world.get(entity, Name)?.value ?? 'Entity'
	}

	rename(entity: Entity, name: string): void {
		if (name.length > MAX_NAME_LENGTH) throw new StrataError('invalid-argument', `Names are at most ${MAX_NAME_LENGTH} characters`)
		const data = this.world.get(entity, Name)
		if (data === undefined) return
		data.value = name
		this.#touch('name')
	}

	getTransform(entity: Entity): Readonly<TransformData> | undefined {
		return this.world.get(entity, Transform)
	}

	setTransform(entity: Entity, patch: Readonly<Partial<TransformData>>): void {
		this.transforms.setLocal(entity, patch)
		this.#touch('transform')
	}

	/**
	 * Rotation around the z axis in degrees, in (-180, 180].
	 */
	rotationDegrees(entity: Entity): number {
		const data = this.world.get(entity, Transform)
		return data === undefined ? 0 : radToDeg(wrapAngle(2 * trig.atan2(data.qz, data.qw)))
	}

	setRotationDegrees(entity: Entity, degrees: number): void {
		const half = degToRad(degrees) / 2
		this.setTransform(entity, { qx: 0, qy: 0, qz: trig.sin(half), qw: trig.cos(half) })
	}

	/**
	 * Moves an entity so its origin sits at a world position, converting through the parent's transform.
	 */
	setWorldPosition(entity: Entity, x: number, y: number): void {
		const link = this.world.get(entity, Parent)
		const parentMatrix = link === undefined ? undefined : this.transforms.worldMatrix(link.parent)
		if (parentMatrix === undefined) {
			this.setTransform(entity, { x, y })
			return
		}
		const inverse = parentMatrix.clone()
		if (!inverse.invert()) return
		const local = inverse.transformPoint(this.#scratch.set(x, y, 0))
		this.setTransform(entity, { x: local.x, y: local.y })
	}

	/**
	 * Entities in outline order: roots first by name, each followed by its children. Cached until the structure or a name changes.
	 */
	rows(): readonly EntityRow[] {
		if (this.#rows !== undefined) return this.#rows
		const info = new Map<Entity, { readonly id: Guid; readonly name: string }>()
		for (const entity of this.world.query(Identity)) {
			info.set(entity, { id: this.world.require(entity, Identity).guid as Guid, name: this.nameOf(entity) })
		}
		const byName = (a: Entity, b: Entity): number => {
			const left = info.get(a)
			const right = info.get(b)
			const leftKey = `${left?.name.toLowerCase() ?? ''}\u0000${left?.id ?? ''}`
			const rightKey = `${right?.name.toLowerCase() ?? ''}\u0000${right?.id ?? ''}`
			return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
		}
		const roots: Entity[] = []
		const children = new Map<Entity, Entity[]>()
		for (const entity of info.keys()) {
			const parent = this.world.get(entity, Parent)?.parent
			if (parent !== undefined && info.has(parent)) {
				const siblings = children.get(parent)
				if (siblings === undefined) children.set(parent, [entity])
				else siblings.push(entity)
			} else {
				roots.push(entity)
			}
		}
		roots.sort(byName)
		for (const siblings of children.values()) siblings.sort(byName)
		const rows: EntityRow[] = []
		const seen = new Set<Entity>()
		const stack: { readonly entity: Entity; readonly depth: number }[] = roots.reverse().map((entity) => ({ entity, depth: 0 }))
		while (stack.length > 0) {
			const { entity, depth } = stack.pop() as { readonly entity: Entity; readonly depth: number }
			const details = info.get(entity)
			if (details === undefined || seen.has(entity)) continue
			seen.add(entity)
			rows.push({ entity, id: details.id, name: details.name, depth })
			for (const child of [...(children.get(entity) ?? [])].reverse()) stack.push({ entity: child, depth: depth + 1 })
		}
		this.#rows = rows
		return rows
	}

	/**
	 * Writes the scene into the project and clears the unsaved-changes flag.
	 */
	async save(): Promise<Result<void>> {
		const text = saveScene(this.world, this.registry)
		if (!text.ok) return text
		const written = await this.project.saveScene(MAIN_SCENE, text.value)
		if (written.ok) {
			this.#dirty = false
			this.#announce('saved')
		}
		return written
	}

	dispose(): void {
		this.transforms.dispose()
		this.world.dispose()
		this.changed.clear()
	}

	#isPersistent(entity: Entity): boolean {
		return this.world.isAlive(entity) && this.world.has(entity, Identity)
	}

	#touch(kind: ChangeKind): void {
		this.#dirty = true
		if (kind === 'structure' || kind === 'name') this.#rows = undefined
		this.#announce(kind)
	}

	#announce(kind: ChangeKind): void {
		try {
			this.changed.emit(kind)
		} catch (error: unknown) {
			this.#logger.error('Editor listener failed', error)
		}
	}
}
