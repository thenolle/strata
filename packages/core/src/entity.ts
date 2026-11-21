import { StrataError } from './errors.ts'

/**
 * Opaque handle: 20 bits of slot index and 12 bits of generation.
 */
export type Entity = number & { readonly __entity: true }

export const INDEX_BITS = 20
export const MAX_ENTITY_INDEX = 0xfffff
export const MAX_ENTITY_GENERATION = 0xfff

export function makeEntity(index: number, generation: number): Entity {
	return (((generation << INDEX_BITS) | index) >>> 0) as Entity
}

export function entityIndex(entity: Entity): number {
	return entity & MAX_ENTITY_INDEX
}

export function entityGeneration(entity: Entity): number {
	return entity >>> INDEX_BITS
}

/**
 * Hands out entity handles. A slot is reused with a higher generation so stale handles are detected.
 * A slot whose generation space is exhausted is retired instead of wrapping, so a stale handle never becomes valid again.
 */
export class EntityAllocator {
	readonly #generations: number[] = []
	readonly #alive: boolean[] = []
	readonly #free: number[] = []
	#count = 0

	get count(): number {
		return this.#count
	}

	allocate(): Entity {
		const index = this.#free.pop() ?? this.#grow()
		this.#alive[index] = true
		this.#count++
		return makeEntity(index, this.#generations[index] ?? 0)
	}

	isAlive(entity: Entity): boolean {
		const index = entityIndex(entity)
		return this.#alive[index] === true && this.#generations[index] === entityGeneration(entity)
	}

	free(entity: Entity): boolean {
		if (!this.isAlive(entity)) return false
		const index = entityIndex(entity)
		const next = (this.#generations[index] ?? 0) + 1
		this.#alive[index] = false
		this.#count--
		if (next <= MAX_ENTITY_GENERATION) {
			this.#generations[index] = next
			this.#free.push(index)
		}
		return true
	}

	#grow(): number {
		const index = this.#generations.length
		if (index > MAX_ENTITY_INDEX) throw new StrataError('capacity-exceeded', 'Entity capacity exceeded')
		this.#generations.push(0)
		this.#alive.push(false)
		return index
	}
}
