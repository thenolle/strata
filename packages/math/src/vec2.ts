import { EPSILON } from './scalar.ts'

/**
 * Two-component vector. Methods mutate in place and return the vector for chaining; use `clone` to keep the original.
 */
export class Vec2 {
	x: number
	y: number

	constructor(x = 0, y = 0) {
		this.x = x
		this.y = y
	}

	set(x: number, y: number): this {
		this.x = x
		this.y = y
		return this
	}

	copy(other: Vec2): this {
		return this.set(other.x, other.y)
	}

	clone(): Vec2 {
		return new Vec2(this.x, this.y)
	}

	add(other: Vec2): this {
		return this.set(this.x + other.x, this.y + other.y)
	}

	sub(other: Vec2): this {
		return this.set(this.x - other.x, this.y - other.y)
	}

	scale(factor: number): this {
		return this.set(this.x * factor, this.y * factor)
	}

	dot(other: Vec2): number {
		return this.x * other.x + this.y * other.y
	}

	lengthSq(): number {
		return this.dot(this)
	}

	length(): number {
		return Math.sqrt(this.lengthSq())
	}

	distanceTo(other: Vec2): number {
		return Math.hypot(this.x - other.x, this.y - other.y)
	}

	normalize(): this {
		const length = this.length()
		return length === 0 ? this : this.scale(1 / length)
	}

	lerp(other: Vec2, t: number): this {
		return this.set(this.x + (other.x - this.x) * t, this.y + (other.y - this.y) * t)
	}

	equals(other: Vec2, epsilon = EPSILON): boolean {
		return Math.abs(this.x - other.x) <= epsilon && Math.abs(this.y - other.y) <= epsilon
	}
}
