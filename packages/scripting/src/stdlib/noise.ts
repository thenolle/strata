import { clamp, lerp } from './math.ts'
import { Random } from './random.ts'

const GRAD2: readonly (readonly [number, number])[] = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)

/**
 * Seeded 2D noise: Perlin, simplex, value and Worley (cellular), plus layered fbm and ridged versions.
 * Perlin, simplex and value noise return -1 to 1, Worley returns 0 to 1.
 */
export class Noise {
	readonly #perm = new Uint8Array(512)

	constructor(seed: number | string = 0) {
		const rng = new Random(seed)
		const table = Array.from({ length: 256 }, (_, index) => index)
		for (let index = 255; index > 0; index--) {
			const other = rng.int(0, index)
			const held = table[index] ?? 0
			table[index] = table[other] ?? 0
			table[other] = held
		}
		for (let index = 0; index < 512; index++) this.#perm[index] = table[index & 255] ?? 0
	}

	#p(index: number): number {
		return this.#perm[index] ?? 0
	}

	#grad(hash: number, x: number, y: number): number {
		const g = GRAD2[hash & 7] ?? [1, 1]
		return g[0] * x + g[1] * y
	}

	perlin2(x: number, y: number): number {
		const xi = Math.floor(x)
		const yi = Math.floor(y)
		const xf = x - xi
		const yf = y - yi
		const X = xi & 255
		const Y = yi & 255
		const u = fade(xf)
		const v = fade(yf)
		const aa = this.#p(this.#p(X) + Y)
		const ab = this.#p(this.#p(X) + Y + 1)
		const ba = this.#p(this.#p(X + 1) + Y)
		const bb = this.#p(this.#p(X + 1) + Y + 1)
		const x1 = lerp(this.#grad(aa, xf, yf), this.#grad(ba, xf - 1, yf), u)
		const x2 = lerp(this.#grad(ab, xf, yf - 1), this.#grad(bb, xf - 1, yf - 1), u)
		return clamp(lerp(x1, x2, v) * 1.4, -1, 1)
	}

	simplex2(x: number, y: number): number {
		const F2 = 0.5 * (Math.sqrt(3) - 1)
		const G2 = (3 - Math.sqrt(3)) / 6
		const s = (x + y) * F2
		const i = Math.floor(x + s)
		const j = Math.floor(y + s)
		const t = (i + j) * G2
		const x0 = x - (i - t)
		const y0 = y - (j - t)
		const i1 = x0 > y0 ? 1 : 0
		const j1 = x0 > y0 ? 0 : 1
		const x1 = x0 - i1 + G2
		const y1 = y0 - j1 + G2
		const x2 = x0 - 1 + 2 * G2
		const y2 = y0 - 1 + 2 * G2
		const ii = i & 255
		const jj = j & 255
		const corner = (cx: number, cy: number, hash: number): number => {
			const falloff = 0.5 - cx * cx - cy * cy
			if (falloff < 0) return 0
			const squared = falloff * falloff
			return squared * squared * this.#grad(hash, cx, cy)
		}
		const n = corner(x0, y0, this.#p(ii + this.#p(jj))) + corner(x1, y1, this.#p(ii + i1 + this.#p(jj + j1))) + corner(x2, y2, this.#p(ii + 1 + this.#p(jj + 1)))
		return clamp(70 * n, -1, 1)
	}

	value2(x: number, y: number): number {
		const xi = Math.floor(x)
		const yi = Math.floor(y)
		const u = fade(x - xi)
		const v = fade(y - yi)
		const h = (a: number, b: number): number => this.#p(this.#p(a & 255) + (b & 255)) / 127.5 - 1
		return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v)
	}

	/** Distance to the nearest of a scattered set of points, for cell and crack patterns. */
	worley2(x: number, y: number): number {
		const xi = Math.floor(x)
		const yi = Math.floor(y)
		let best = Infinity
		for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				const cx = xi + dx
				const cy = yi + dy
				const hx = this.#p((cx & 255) + this.#p(cy & 255)) / 255
				const hy = this.#p(this.#p((cx & 255) + 31) + (cy & 255)) / 255
				best = Math.min(best, (cx + hx - x) ** 2 + (cy + hy - y) ** 2)
			}
		}
		return Math.min(1, Math.sqrt(best))
	}

	/** Several layers of Perlin noise at growing detail, normalized to -1 to 1. */
	fbm2(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
		let total = 0
		let amplitude = 1
		let frequency = 1
		let norm = 0
		for (let octave = 0; octave < octaves; octave++) {
			total += this.perlin2(x * frequency, y * frequency) * amplitude
			norm += amplitude
			amplitude *= gain
			frequency *= lacunarity
		}
		return norm === 0 ? 0 : total / norm
	}

	/** Sharp ridges, 0 to 1. */
	ridged2(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
		let total = 0
		let amplitude = 1
		let frequency = 1
		let norm = 0
		for (let octave = 0; octave < octaves; octave++) {
			total += (1 - Math.abs(this.perlin2(x * frequency, y * frequency))) * amplitude
			norm += amplitude
			amplitude *= gain
			frequency *= lacunarity
		}
		return norm === 0 ? 0 : total / norm
	}
}
