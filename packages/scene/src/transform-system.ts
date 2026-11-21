import { DisposableStore, Logger, StrataError, createComponentData, nullSink, type Disposable, type Entity, type World } from '@strata/core'
import { Mat4, Quat, Vec3 } from '@strata/math'
import { Parent, Transform, type TransformData } from './components.ts'

const NO_ENTITIES: readonly Entity[] = []

/**
 * Maintains world matrices for entities with a `Transform`, parents before children.
 * Results reflect the last `update()`. Edit transforms through `setLocal`, or call `markDirty` after mutating directly.
 * A parent without a `Transform`, or a dead parent, is ignored and the child acts as a root. Cycles are excluded and logged.
 */
export class TransformSystem implements Disposable {
	readonly #world: World
	readonly #logger: Logger
	readonly #subscriptions = new DisposableStore()
	readonly #dirty = new Set<Entity>()
	readonly #worlds = new Map<Entity, Mat4>()
	readonly #children = new Map<Entity, Entity[]>()
	readonly #parentOf = new Map<Entity, Entity>()
	readonly #position = new Vec3()
	readonly #rotation = new Quat()
	readonly #scale = new Vec3()
	readonly #localMatrix = new Mat4()
	#structureChanged = true
	#cyclic = 0

	constructor(world: World, logger: Logger = new Logger(nullSink, 'scene.transform')) {
		this.#world = world
		this.#logger = logger
		const structural = (name: string): void => {
			if (name === Transform.name || name === Parent.name) this.#structureChanged = true
		}
		this.#subscriptions.add(world.componentAdded.subscribe((event) => structural(event.component)))
		this.#subscriptions.add(world.componentRemoved.subscribe((event) => structural(event.component)))
		this.#subscriptions.add(world.despawned.subscribe(() => { this.#structureChanged = true }))
	}

	get cyclicCount(): number {
		return this.#cyclic
	}

	worldMatrix(entity: Entity): Mat4 | undefined {
		return this.#worlds.get(entity)
	}

	children(entity: Entity): readonly Entity[] {
		return this.#children.get(entity) ?? NO_ENTITIES
	}

	markDirty(entity: Entity): void {
		this.#dirty.add(entity)
	}

	setLocal(entity: Entity, patch: Readonly<Partial<TransformData>>): void {
		const current = this.#world.require(entity, Transform)
		Object.assign(current, createComponentData(Transform, { ...current, ...patch }))
		this.#dirty.add(entity)
	}

	setParent(child: Entity, parent?: Entity): void {
		const world = this.#world
		if (!world.isAlive(child)) throw new StrataError('invalid-entity', `Entity ${child} is not alive`)
		if (parent === undefined) {
			world.remove(child, Parent)
			return
		}
		if (!world.isAlive(parent)) throw new StrataError('invalid-entity', `Entity ${parent} is not alive`)
		let cursor: Entity | undefined = parent
		for (let steps = 0; cursor !== undefined; steps++) {
			if (cursor === child || steps > world.entityCount) throw new StrataError('invalid-argument', 'Reparenting would create a cycle')
			cursor = world.get(cursor, Parent)?.parent
		}
		const link = world.get(child, Parent)
		if (link === undefined) {
			world.add(child, Parent, { parent })
		} else {
			link.parent = parent
			this.#structureChanged = true
		}
	}

	/**
	 * Despawns an entity and every descendant, deepest first. Returns how many entities were removed.
	 */
	despawnTree(root: Entity): number {
		const world = this.#world
		const byParent = new Map<Entity, Entity[]>()
		for (const entity of world.query(Parent)) {
			const link = world.get(entity, Parent)
			if (link === undefined) continue
			const siblings = byParent.get(link.parent)
			if (siblings === undefined) byParent.set(link.parent, [entity])
			else siblings.push(entity)
		}
		const order: Entity[] = []
		const seen = new Set<Entity>()
		const stack: Entity[] = [root]
		while (stack.length > 0) {
			const entity = stack.pop() as Entity
			if (seen.has(entity)) continue
			seen.add(entity)
			order.push(entity)
			stack.push(...(byParent.get(entity) ?? NO_ENTITIES))
		}
		let removed = 0
		for (const entity of order.reverse()) {
			if (world.despawn(entity)) removed++
		}
		return removed
	}

	update(): void {
		if (this.#structureChanged) {
			this.#rebuild()
			return
		}
		if (this.#dirty.size === 0) return
		for (const entity of this.#dirty) {
			if (!this.#worlds.has(entity) || this.#hasDirtyAncestor(entity)) continue
			this.#recompute(entity)
		}
		this.#dirty.clear()
	}

	dispose(): void {
		this.#subscriptions.dispose()
		this.#dirty.clear()
		this.#worlds.clear()
		this.#children.clear()
		this.#parentOf.clear()
	}

	#hasDirtyAncestor(entity: Entity): boolean {
		let cursor = this.#parentOf.get(entity)
		while (cursor !== undefined) {
			if (this.#dirty.has(cursor)) return true
			cursor = this.#parentOf.get(cursor)
		}
		return false
	}

	#rebuild(): void {
		const world = this.#world
		this.#children.clear()
		this.#parentOf.clear()
		for (const entity of this.#worlds.keys()) {
			if (!world.has(entity, Transform)) this.#worlds.delete(entity)
		}
		const entities = world.query(Transform)
		const roots: Entity[] = []
		for (const entity of entities) {
			const link = world.get(entity, Parent)
			if (link !== undefined && world.has(link.parent, Transform)) {
				this.#parentOf.set(entity, link.parent)
				const siblings = this.#children.get(link.parent)
				if (siblings === undefined) this.#children.set(link.parent, [entity])
				else siblings.push(entity)
			} else {
				roots.push(entity)
			}
		}
		const reached = new Set<Entity>()
		for (const root of roots) this.#recompute(root, reached)
		const unreached = entities.filter((entity) => !reached.has(entity))
		for (const entity of unreached) this.#worlds.delete(entity)
		this.#cyclic = unreached.length
		if (unreached.length > 0) this.#logger.warn('Transform hierarchy contains a cycle', { entities: unreached })
		this.#dirty.clear()
		this.#structureChanged = false
	}

	#recompute(root: Entity, reached?: Set<Entity>): void {
		const stack: Entity[] = [root]
		while (stack.length > 0) {
			const entity = stack.pop() as Entity
			reached?.add(entity)
			this.#compute(entity)
			stack.push(...(this.#children.get(entity) ?? NO_ENTITIES))
		}
	}

	#compute(entity: Entity): void {
		const data = this.#world.get(entity, Transform)
		if (data === undefined) return
		this.#position.set(data.x, data.y, data.z)
		this.#rotation.set(data.qx, data.qy, data.qz, data.qw).normalize()
		this.#scale.set(data.sx, data.sy, data.sz)
		this.#localMatrix.compose(this.#position, this.#rotation, this.#scale)
		let matrix = this.#worlds.get(entity)
		if (matrix === undefined) {
			matrix = new Mat4()
			this.#worlds.set(entity, matrix)
		}
		const parent = this.#parentOf.get(entity)
		const parentMatrix = parent === undefined ? undefined : this.#worlds.get(parent)
		if (parentMatrix === undefined) matrix.copy(this.#localMatrix)
		else matrix.multiply(parentMatrix, this.#localMatrix)
	}
}
