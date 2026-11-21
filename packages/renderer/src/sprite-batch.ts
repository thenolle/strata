import { StrataError } from '@strata/core'

export const SPRITE_STRIDE = 40
const FLOATS_PER_SPRITE = SPRITE_STRIDE / 4

/**
 * Packs a color with channels in 0..1 into the byte layout the sprite pipeline reads.
 */
export function packColor(r: number, g: number, b: number, a = 1): number {
	const channel = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255)
	return ((channel(a) << 24) | (channel(b) << 16) | (channel(g) << 8) | channel(r)) >>> 0
}

/**
 * CPU-side list of sprite instances, stored in the exact layout uploaded to the GPU.
 * Each sprite is a centered rectangle with a rotation, a UV rectangle (v0 is the top row) and a packed color.
 */
export class SpriteBatch {
	#buffer: ArrayBuffer
	#floats: Float32Array
	#words: Uint32Array
	#capacity: number
	#count = 0

	constructor(capacity = 256) {
		if (!Number.isInteger(capacity) || capacity < 1) throw new StrataError('invalid-argument', 'Sprite capacity must be a positive integer')
		this.#capacity = capacity
		this.#buffer = new ArrayBuffer(capacity * SPRITE_STRIDE)
		this.#floats = new Float32Array(this.#buffer)
		this.#words = new Uint32Array(this.#buffer)
	}

	get count(): number {
		return this.#count
	}

	get buffer(): ArrayBuffer {
		return this.#buffer
	}

	get byteLength(): number {
		return this.#count * SPRITE_STRIDE
	}

	clear(): void {
		this.#count = 0
	}

	add(x: number, y: number, width: number, height: number, rotation = 0, color = 0xffffffff, u0 = 0, v0 = 0, u1 = 1, v1 = 1): void {
		if (this.#count === this.#capacity) this.#grow()
		const o = this.#count * FLOATS_PER_SPRITE
		const f = this.#floats
		f[o] = x
		f[o + 1] = y
		f[o + 2] = width
		f[o + 3] = height
		f[o + 4] = rotation
		f[o + 5] = u0
		f[o + 6] = v0
		f[o + 7] = u1
		f[o + 8] = v1
		this.#words[o + 9] = color
		this.#count++
	}

	#grow(): void {
		const capacity = this.#capacity * 2
		const buffer = new ArrayBuffer(capacity * SPRITE_STRIDE)
		new Uint8Array(buffer).set(new Uint8Array(this.#buffer, 0, this.byteLength))
		this.#buffer = buffer
		this.#floats = new Float32Array(buffer)
		this.#words = new Uint32Array(buffer)
		this.#capacity = capacity
	}
}
