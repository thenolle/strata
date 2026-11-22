/** Reuses objects instead of creating new ones, to avoid hitches from garbage collection. */
export class Pool<T> {
	readonly #free: T[] = []

	constructor(private readonly create: () => T, private readonly reset: (item: T) => void = () => undefined) {}

	get available(): number {
		return this.#free.length
	}
	acquire(): T {
		return this.#free.pop() ?? this.create()
	}
	release(item: T): void {
		this.reset(item)
		this.#free.push(item)
	}
}

/** A compact set of small whole numbers. */
export class Bitset {
	readonly #words: Uint32Array

	constructor(readonly size: number) {
		this.#words = new Uint32Array(Math.ceil(size / 32))
	}

	get(index: number): boolean {
		return index >= 0 && index < this.size && ((this.#words[index >>> 5] ?? 0) & (1 << (index & 31))) !== 0
	}
	set(index: number, value = true): void {
		if (index < 0 || index >= this.size) return
		const word = index >>> 5
		const bit = 1 << (index & 31)
		this.#words[word] = value ? (this.#words[word] ?? 0) | bit : (this.#words[word] ?? 0) & ~bit
	}
	get count(): number {
		let total = 0
		for (let index = 0; index < this.size; index++) if (this.get(index)) total++
		return total
	}
}

/** Runs a function once and remembers the result. */
export function once<T>(compute: () => T): () => T {
	let done = false
	let value: T
	return () => {
		if (!done) {
			value = compute()
			done = true
		}
		return value
	}
}

/** Remembers the result of a function for each distinct argument. */
export function memoize<A, R>(compute: (argument: A) => R): (argument: A) => R {
	const cache = new Map<A, R>()
	return (argument) => {
		if (!cache.has(argument)) cache.set(argument, compute(argument))
		return cache.get(argument) as R
	}
}
