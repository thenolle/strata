import { EPSILON } from './scalar.ts'
import * as trig from './trig.ts'
import type { Vec3 } from './vec3.ts'

/**
 * Rotation quaternion, identity by default. Methods mutate in place and return the quaternion for chaining.
 */
export class Quat {
	x: number
	y: number
	z: number
	w: number

	constructor(x = 0, y = 0, z = 0, w = 1) {
		this.x = x
		this.y = y
		this.z = z
		this.w = w
	}

	set(x: number, y: number, z: number, w: number): this {
		this.x = x
		this.y = y
		this.z = z
		this.w = w
		return this
	}

	copy(other: Quat): this {
		return this.set(other.x, other.y, other.z, other.w)
	}

	clone(): Quat {
		return new Quat(this.x, this.y, this.z, this.w)
	}

	identity(): this {
		return this.set(0, 0, 0, 1)
	}

	/**
	 * Replaces this rotation with `this * other`, which applies `other` first.
	 */
	multiply(other: Quat): this {
		const { x: ax, y: ay, z: az, w: aw } = this
		const { x: bx, y: by, z: bz, w: bw } = other
		return this.set(
			ax * bw + aw * bx + ay * bz - az * by,
			ay * bw + aw * by + az * bx - ax * bz,
			az * bw + aw * bz + ax * by - ay * bx,
			aw * bw - ax * bx - ay * by - az * bz
		)
	}

	conjugate(): this {
		return this.set(-this.x, -this.y, -this.z, this.w)
	}

	/**
	 * Scales to unit length. A zero quaternion becomes the identity.
	 */
	normalize(): this {
		const length = Math.hypot(this.x, this.y, this.z, this.w)
		return length === 0 ? this.identity() : this.set(this.x / length, this.y / length, this.z / length, this.w / length)
	}

	/**
	 * Sets a rotation of `radians` around a unit-length axis.
	 */
	setFromAxisAngle(axis: Vec3, radians: number): this {
		const half = radians / 2
		const s = trig.sin(half)
		return this.set(axis.x * s, axis.y * s, axis.z * s, trig.cos(half))
	}

	/**
	 * Rotates a vector in place. The quaternion is assumed to be unit length.
	 */
	rotate(vector: Vec3): Vec3 {
		const { x, y, z, w } = this
		const ux = y * vector.z - z * vector.y
		const uy = z * vector.x - x * vector.z
		const uz = x * vector.y - y * vector.x
		const vx = y * uz - z * uy
		const vy = z * ux - x * uz
		const vz = x * uy - y * ux
		return vector.set(vector.x + 2 * (w * ux + vx), vector.y + 2 * (w * uy + vy), vector.z + 2 * (w * uz + vz))
	}

	/**
	 * Spherical interpolation along the shortest arc.
	 */
	slerp(other: Quat, t: number): this {
		let bx = other.x
		let by = other.y
		let bz = other.z
		let bw = other.w
		let cosine = this.x * bx + this.y * by + this.z * bz + this.w * bw
		if (cosine < 0) {
			cosine = -cosine
			bx = -bx
			by = -by
			bz = -bz
			bw = -bw
		}
		let from = 1 - t
		let to = t
		if (1 - cosine > EPSILON) {
			const sine = Math.sqrt(1 - cosine * cosine)
			const omega = trig.atan2(sine, cosine)
			from = trig.sin((1 - t) * omega) / sine
			to = trig.sin(t * omega) / sine
		}
		return this.set(from * this.x + to * bx, from * this.y + to * by, from * this.z + to * bz, from * this.w + to * bw)
	}

	equals(other: Quat, epsilon = EPSILON): boolean {
		return (
			Math.abs(this.x - other.x) <= epsilon &&
			Math.abs(this.y - other.y) <= epsilon &&
			Math.abs(this.z - other.z) <= epsilon &&
			Math.abs(this.w - other.w) <= epsilon
		)
	}
}
