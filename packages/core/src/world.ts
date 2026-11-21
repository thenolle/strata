import { createComponentData, type ComponentData, type ComponentDefinition, type ComponentHandle, type FieldSchema } from './component.ts'
import type { Disposable } from './disposable.ts'
import { Emitter } from './events.ts'
import { EntityAllocator, type Entity } from './entity.ts'
import { StrataError } from './errors.ts'
import { SparseSet } from './storage.ts'

export interface ComponentEvent {
	readonly entity: Entity
	readonly component: string
}

interface Store {
	readonly name: string
	readonly set: SparseSet<unknown>
}

/**
 * Owns entities and their components. It is the single source of truth for gameplay and editing.
 * Query results are snapshots whose order is unspecified but identical for identical operation sequences.
 */
export class World implements Disposable {
	readonly spawned = new Emitter<Entity>()
	readonly despawned = new Emitter<Entity>()
	readonly componentAdded = new Emitter<ComponentEvent>()
	readonly componentRemoved = new Emitter<ComponentEvent>()
	readonly #allocator = new EntityAllocator()
	readonly #stores = new Map<ComponentHandle, Store>()
	#disposed = false

	get entityCount(): number {
		return this.#allocator.count
	}

	spawn(): Entity {
		this.#requireLive()
		const entity = this.#allocator.allocate()
		this.spawned.emit(entity)
		return entity
	}

	isAlive(entity: Entity): boolean {
		return this.#allocator.isAlive(entity)
	}

	despawn(entity: Entity): boolean {
		if (!this.#allocator.isAlive(entity)) return false
		for (const store of this.#stores.values()) {
			if (store.set.delete(entity)) this.componentRemoved.emit({ entity, component: store.name })
		}
		this.#allocator.free(entity)
		this.despawned.emit(entity)
		return true
	}

	add<S extends FieldSchema>(entity: Entity, definition: ComponentDefinition<S>, init?: Readonly<Partial<ComponentData<S>>>): ComponentData<S> {
		this.#requireLive()
		if (!this.#allocator.isAlive(entity)) throw new StrataError('invalid-entity', `Entity ${entity} is not alive`)
		const store = this.#storeFor(definition)
		if (store.set.has(entity)) throw new StrataError('duplicate-component', `Entity ${entity} already has "${definition.name}"`)
		const data = createComponentData(definition, init)
		store.set.set(entity, data)
		this.componentAdded.emit({ entity, component: definition.name })
		return data
	}

	get<S extends FieldSchema>(entity: Entity, definition: ComponentDefinition<S>): ComponentData<S> | undefined {
		return this.#stores.get(definition)?.set.get(entity) as ComponentData<S> | undefined
	}

	require<S extends FieldSchema>(entity: Entity, definition: ComponentDefinition<S>): ComponentData<S> {
		const data = this.get(entity, definition)
		if (data === undefined) throw new StrataError('missing-component', `Entity ${entity} has no "${definition.name}"`)
		return data
	}

	has(entity: Entity, component: ComponentHandle): boolean {
		return this.#stores.get(component)?.set.has(entity) ?? false
	}

	remove(entity: Entity, component: ComponentHandle): boolean {
		const store = this.#stores.get(component)
		if (store === undefined || !store.set.delete(entity)) return false
		this.componentRemoved.emit({ entity, component: store.name })
		return true
	}

	query(...components: readonly ComponentHandle[]): Entity[] {
		if (components.length === 0) return []
		const sets: SparseSet<unknown>[] = []
		for (const component of components) {
			const store = this.#stores.get(component)
			if (store === undefined) return []
			sets.push(store.set)
		}
		const driver = sets.reduce((smallest, candidate) => (candidate.size < smallest.size ? candidate : smallest))
		const matches: Entity[] = []
		for (const entity of driver.entities) {
			if (sets.every((set) => set.has(entity))) matches.push(entity)
		}
		return matches
	}

	dispose(): void {
		if (this.#disposed) return
		this.#disposed = true
		for (const store of this.#stores.values()) store.set.clear()
		this.#stores.clear()
		this.spawned.clear()
		this.despawned.clear()
		this.componentAdded.clear()
		this.componentRemoved.clear()
	}

	#storeFor(component: ComponentHandle): Store {
		let store = this.#stores.get(component)
		if (store === undefined) {
			store = { name: component.name, set: new SparseSet<unknown>() }
			this.#stores.set(component, store)
		}
		return store
	}

	#requireLive(): void {
		if (this.#disposed) throw new StrataError('disposed', 'World has been disposed')
	}
}
