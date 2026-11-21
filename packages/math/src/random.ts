import { StrataError } from '@strata/core'

const MULTIPLIER_HIGH = 0x5851f42d
const MULTIPLIER_LOW = 0x4c957f2d
const TWO_32 = 0x100000000

export interface Pcg32State {
	readonly stateHigh: number
	readonly stateLow: number
	readonly incrementHigh: number
	readonly incrementLow: number
}

function splitSeed(value: number, label: string): [number, number] {
	if (!Number.isSafeInteger(value) || value < 0) throw new StrataError('invalid-argument', `${label} must be a non-negative safe integer`)
	return [Math.floor(value / TWO_32) >>> 0, value >>> 0]
}

function isUint32(value: number): boolean {
	return Number.isInteger(value) && value >= 0 && value < TWO_32
}

/**
 * Seeded PCG-XSH-RR 64/32 generator with 64-bit state held as two 32-bit halves.
 * Identical seeds and streams produce identical sequences on every engine.
 */
export class Pcg32 {
	#high = 0
	#low = 0
	#incrementHigh = 0
	#incrementLow = 0

	constructor(seed = 0, stream = 0) {
		const [seedHigh, seedLow] = splitSeed(seed, 'seed')
		const [streamHigh, streamLow] = splitSeed(stream, 'stream')
		this.#incrementHigh = ((streamHigh << 1) | (streamLow >>> 31)) >>> 0
		this.#incrementLow = ((streamLow << 1) | 1) >>> 0
		this.#step()
		const sumLow = this.#low + seedLow
		this.#low = sumLow >>> 0
		this.#high = (this.#high + seedHigh + (sumLow > 0xffffffff ? 1 : 0)) >>> 0
		this.#step()
	}

	static fromState(state: Pcg32State): Pcg32 {
		const values = [state.stateHigh, state.stateLow, state.incrementHigh, state.incrementLow]
		if (!values.every(isUint32) || (state.incrementLow & 1) === 0) throw new StrataError('invalid-argument', 'Invalid generator state')
		const generator = new Pcg32()
		generator.#high = state.stateHigh
		generator.#low = state.stateLow
		generator.#incrementHigh = state.incrementHigh
		generator.#incrementLow = state.incrementLow
		return generator
	}

	snapshot(): Pcg32State {
		return { stateHigh: this.#high, stateLow: this.#low, incrementHigh: this.#incrementHigh, incrementLow: this.#incrementLow }
	}

	/**
	 * Creates an independent child generator, advancing this one. Use one child per subsystem.
	 */
	fork(stream: number): Pcg32 {
		return new Pcg32(this.nextU32(), stream)
	}

	nextU32(): number {
		const high = this.#high
		const low = this.#low
		this.#step()
		const shiftedLow = ((high << 14) | (low >>> 18)) >>> 0
		const shiftedHigh = high >>> 18
		const xorLow = (shiftedLow ^ low) >>> 0
		const xorHigh = (shiftedHigh ^ high) >>> 0
		const xorShifted = ((xorLow >>> 27) | (xorHigh << 5)) >>> 0
		const rotation = high >>> 27
		return ((xorShifted >>> rotation) | (xorShifted << ((32 - rotation) & 31))) >>> 0
	}

	/**
	 * Uniform float in [0, 1).
	 */
	nextFloat(): number {
		return this.nextU32() / TWO_32
	}

	/**
	 * Unbiased integer in [0, maxExclusive).
	 */
	nextInt(maxExclusive: number): number {
		if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > TWO_32) throw new StrataError('invalid-argument', 'maxExclusive must be an integer in 1..2^32')
		const threshold = (TWO_32 - maxExclusive) % maxExclusive
		let value = this.nextU32()
		while (value < threshold) value = this.nextU32()
		return value % maxExclusive
	}

	intRange(minInclusive: number, maxInclusive: number): number {
		if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive) || minInclusive > maxInclusive) throw new StrataError('invalid-argument', 'intRange needs integers with min <= max')
		return minInclusive + this.nextInt(maxInclusive - minInclusive + 1)
	}

	range(min: number, max: number): number {
		return min + this.nextFloat() * (max - min)
	}

	chance(probability: number): boolean {
		return this.nextFloat() < probability
	}

	pick<T>(items: readonly T[]): T {
		if (items.length === 0) throw new StrataError('invalid-argument', 'Cannot pick from an empty list')
		return items[this.nextInt(items.length)] as T
	}

	/**
	 * Fisher-Yates shuffle in place.
	 */
	shuffle<T>(items: T[]): T[] {
		for (let i = items.length - 1; i > 0; i--) {
			const j = this.nextInt(i + 1)
			const current = items[i] as T
			items[i] = items[j] as T
			items[j] = current
		}
		return items
	}

	#step(): void {
		const low = this.#low
		const high = this.#high
		const a0 = low & 0xffff
		const a1 = low >>> 16
		const b0 = MULTIPLIER_LOW & 0xffff
		const b1 = MULTIPLIER_LOW >>> 16
		const p00 = a0 * b0
		const mid = a0 * b1 + a1 * b0 + (p00 >>> 16)
		const productLow = (((mid & 0xffff) << 16) | (p00 & 0xffff)) >>> 0
		const productHigh = (a1 * b1 + Math.floor(mid / 0x10000) + Math.imul(high, MULTIPLIER_LOW) + Math.imul(low, MULTIPLIER_HIGH)) >>> 0
		const sumLow = productLow + this.#incrementLow
		this.#low = sumLow >>> 0
		this.#high = (productHigh + this.#incrementHigh + (sumLow > 0xffffffff ? 1 : 0)) >>> 0
	}
}
