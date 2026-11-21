import { EPSILON } from './scalar.ts'

/**
 * Three-component vector. Methods mutate in place and return the vector for chaining; use `clone` to keep the original.
 */
export class Vec3 {
	x: number
	y: number
	z: number

	constructor(x = 0, y = 0, z = 0) {
		this.x = x
		this.y = y
		this.z = z
	}

	set(x: number, y: number, z: number): this {
		this.x = x
		this.y = y
		this.z = z
		return this
	}

	copy(other: Vec3): this {
		return this.set(other.x, other.y, other.z)
	}

	clone(): Vec3 {
		return new Vec3(this.x, this.y, this.z)
	}

	add(other: Vec3): this {
		return this.set(this.x + other.x, this.y + other.y, this.z + other.z)
	}

	sub(other: Vec3): this {
		return this.set(this.x - other.x, this.y - other.y, this.z - other.z)
	}

	scale(factor: number): this {
		return this.set(this.x * factor, this.y * factor, this.z * factor)
	}

	dot(other: Vec3): number {
		return this.x * other.x + this.y * other.y + this.z * other.z
	}

	cross(other: Vec3): this {
		return this.set(this.y * other.z - this.z * other.y, this.z * other.x - this.x * other.z, this.x * other.y - this.y * other.x)
	}

	lengthSq(): number {
		return this.dot(this)
	}

	length(): number {
		return Math.sqrt(this.lengthSq())
	}

	distanceTo(other: Vec3): number {
		return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z)
	}

	normalize(): this {
		const length = this.length()
		return length === 0 ? this : this.scale(1 / length)
	}

	lerp(other: Vec3, t: number): this {
		return this.set(this.x + (other.x - this.x) * t, this.y + (other.y - this.y) * t, this.z + (other.z - this.z) * t)
	}

	equals(other: Vec3, epsilon = EPSILON): boolean {
		return Math.abs(this.x - other.x) <= epsilon && Math.abs(this.y - other.y) <= epsilon && Math.abs(this.z - other.z) <= epsilon
	}
}
