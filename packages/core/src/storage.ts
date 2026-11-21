import { entityIndex, type Entity } from './entity.ts'

/**
 * Packed per-component storage with constant-time insert, lookup and swap-removal.
 */
export class SparseSet<T> {
	readonly #sparse: number[] = []
	readonly #entities: Entity[] = []
	readonly #values: T[] = []

	get size(): number {
		return this.#entities.length
	}

	/**
	 * Live dense entity list. Do not mutate the set while iterating it.
	 */
	get entities(): readonly Entity[] {
		return this.#entities
	}

	has(entity: Entity): boolean {
		const position = this.#sparse[entityIndex(entity)]
		return position !== undefined && this.#entities[position] === entity
	}

	get(entity: Entity): T | undefined {
		const position = this.#sparse[entityIndex(entity)]
		if (position === undefined || this.#entities[position] !== entity) return undefined
		return this.#values[position]
	}

	set(entity: Entity, value: T): void {
		const index = entityIndex(entity)
		const position = this.#sparse[index]
		if (position !== undefined && this.#entities[position] === entity) {
			this.#values[position] = value
			return
		}
		this.#sparse[index] = this.#entities.length
		this.#entities.push(entity)
		this.#values.push(value)
	}

	delete(entity: Entity): boolean {
		const position = this.#sparse[entityIndex(entity)]
		if (position === undefined || this.#entities[position] !== entity) return false
		const lastEntity = this.#entities[this.#entities.length - 1]
		const lastValue = this.#values[this.#values.length - 1]
		if (lastEntity !== undefined && lastValue !== undefined && lastEntity !== entity) {
			this.#entities[position] = lastEntity
			this.#values[position] = lastValue
			this.#sparse[entityIndex(lastEntity)] = position
		}
		this.#entities.pop()
		this.#values.pop()
		return true
	}

	clear(): void {
		this.#sparse.length = 0
		this.#entities.length = 0
		this.#values.length = 0
	}
}
