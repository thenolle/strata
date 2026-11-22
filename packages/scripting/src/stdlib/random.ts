function seedFrom(text: string): () => number {
	let h = 1779033703 ^ text.length
	for (let index = 0; index < text.length; index++) {
		h = Math.imul(h ^ text.charCodeAt(index), 3432918353)
		h = (h << 13) | (h >>> 19)
	}
	return () => {
		h = Math.imul(h ^ (h >>> 16), 2246822507)
		h = Math.imul(h ^ (h >>> 13), 3266489909)
		return (h ^= h >>> 16) >>> 0
	}
}

/**
 * A seedable random generator (SFC32). The same seed always gives the same sequence, so levels and tests can be repeated.
 */
export class Random {
	#a: number
	#b: number
	#c: number
	#d: number

	constructor(seed: number | string = Date.now() ^ Math.floor(Math.random() * 0xffffffff)) {
		const next = seedFrom(String(seed))
		this.#a = next()
		this.#b = next()
		this.#c = next()
		this.#d = next()
		for (let index = 0; index < 12; index++) this.nextUint()
	}

	nextUint(): number {
		const t = (((this.#a + this.#b) | 0) + this.#d) | 0
		this.#d = (this.#d + 1) | 0
		this.#a = this.#b ^ (this.#b >>> 9)
		this.#b = (this.#c + (this.#c << 3)) | 0
		this.#c = (this.#c << 21) | (this.#c >>> 11)
		this.#c = (this.#c + t) | 0
		return t >>> 0
	}

	/** A number from 0 up to, not including, 1. */
	next(): number {
		return this.nextUint() / 4294967296
	}
	float(min = 0, max = 1): number {
		return min + (max - min) * this.next()
	}
	/** A whole number from min to max, both included. */
	int(min: number, max: number): number {
		return min + Math.floor(this.next() * (Math.floor(max) - Math.ceil(min) + 1))
	}
	bool(): boolean {
		return this.next() < 0.5
	}
	chance(probability: number): boolean {
		return this.next() < probability
	}
	sign(): number {
		return this.bool() ? 1 : -1
	}
	pick<T>(items: readonly T[]): T | undefined {
		return items[this.int(0, items.length - 1)]
	}
	weighted<T>(items: readonly T[], weights: readonly number[]): T | undefined {
		const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0)
		if (total <= 0) return undefined
		let roll = this.next() * total
		for (let index = 0; index < items.length; index++) {
			roll -= Math.max(0, weights[index] ?? 0)
			if (roll < 0) return items[index]
		}
		return items[items.length - 1]
	}
	shuffle<T>(items: readonly T[]): T[] {
		const copy = [...items]
		for (let index = copy.length - 1; index > 0; index--) {
			const other = this.int(0, index)
			const held = copy[index] as T
			copy[index] = copy[other] as T
			copy[other] = held
		}
		return copy
	}
	sample<T>(items: readonly T[], count: number): T[] {
		return this.shuffle(items).slice(0, Math.max(0, count))
	}
	/** A normally distributed number (Box-Muller). */
	gaussian(mean = 0, deviation = 1): number {
		const u = 1 - this.next()
		const v = this.next()
		return mean + deviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
	}
	/** A random direction as an angle in radians. */
	angle(): number {
		return this.next() * Math.PI * 2
	}
	/** A random point inside a circle. */
	inCircle(radius = 1): { readonly x: number; readonly y: number } {
		const angle = this.angle()
		const distance = Math.sqrt(this.next()) * radius
		return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance }
	}
	dice(sides: number, count = 1): number {
		let total = 0
		for (let index = 0; index < count; index++) total += this.int(1, sides)
		return total
	}
	/** An independent generator that continues from this one's state. */
	fork(): Random {
		return new Random(this.nextUint())
	}
}

/** A shared generator with a different sequence every run. */
export const random = new Random()
