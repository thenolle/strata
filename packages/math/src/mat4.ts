import { EPSILON } from './scalar.ts'
import type { Quat } from './quat.ts'
import type { Vec3 } from './vec3.ts'

function at(values: Float64Array, index: number): number {
	return values[index] as number
}

/**
 * 4x4 matrix in column-major order, identity by default. Methods mutate in place and return the matrix for chaining.
 */
export class Mat4 {
	readonly elements = new Float64Array(16)

	constructor() {
		this.identity()
	}

	identity(): this {
		const e = this.elements
		e.fill(0)
		e[0] = 1
		e[5] = 1
		e[10] = 1
		e[15] = 1
		return this
	}

	copy(other: Mat4): this {
		this.elements.set(other.elements)
		return this
	}

	clone(): Mat4 {
		return new Mat4().copy(this)
	}

	/**
	 * Builds translation * rotation * scale. The rotation is assumed to be unit length.
	 */
	compose(position: Vec3, rotation: Quat, scale: Vec3): this {
		const e = this.elements
		const { x, y, z, w } = rotation
		const x2 = x + x
		const y2 = y + y
		const z2 = z + z
		const xx = x * x2
		const xy = x * y2
		const xz = x * z2
		const yy = y * y2
		const yz = y * z2
		const zz = z * z2
		const wx = w * x2
		const wy = w * y2
		const wz = w * z2
		e[0] = (1 - (yy + zz)) * scale.x
		e[1] = (xy + wz) * scale.x
		e[2] = (xz - wy) * scale.x
		e[3] = 0
		e[4] = (xy - wz) * scale.y
		e[5] = (1 - (xx + zz)) * scale.y
		e[6] = (yz + wx) * scale.y
		e[7] = 0
		e[8] = (xz + wy) * scale.z
		e[9] = (yz - wx) * scale.z
		e[10] = (1 - (xx + yy)) * scale.z
		e[11] = 0
		e[12] = position.x
		e[13] = position.y
		e[14] = position.z
		e[15] = 1
		return this
	}

	/**
	 * Replaces this matrix with `a * b`, which applies `b` first. Either input may be this matrix.
	 */
	multiply(a: Mat4, b: Mat4): this {
		const ae = a.elements
		const be = b.elements
		const out = this.elements
		const a00 = at(ae, 0)
		const a01 = at(ae, 1)
		const a02 = at(ae, 2)
		const a03 = at(ae, 3)
		const a10 = at(ae, 4)
		const a11 = at(ae, 5)
		const a12 = at(ae, 6)
		const a13 = at(ae, 7)
		const a20 = at(ae, 8)
		const a21 = at(ae, 9)
		const a22 = at(ae, 10)
		const a23 = at(ae, 11)
		const a30 = at(ae, 12)
		const a31 = at(ae, 13)
		const a32 = at(ae, 14)
		const a33 = at(ae, 15)
		for (let column = 0; column < 4; column++) {
			const o = column * 4
			const b0 = at(be, o)
			const b1 = at(be, o + 1)
			const b2 = at(be, o + 2)
			const b3 = at(be, o + 3)
			out[o] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30
			out[o + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31
			out[o + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32
			out[o + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33
		}
		return this
	}

	/**
	 * Inverts in place. Returns false and leaves the matrix unchanged when it is singular.
	 */
	invert(): boolean {
		const e = this.elements
		const a00 = at(e, 0)
		const a01 = at(e, 1)
		const a02 = at(e, 2)
		const a03 = at(e, 3)
		const a10 = at(e, 4)
		const a11 = at(e, 5)
		const a12 = at(e, 6)
		const a13 = at(e, 7)
		const a20 = at(e, 8)
		const a21 = at(e, 9)
		const a22 = at(e, 10)
		const a23 = at(e, 11)
		const a30 = at(e, 12)
		const a31 = at(e, 13)
		const a32 = at(e, 14)
		const a33 = at(e, 15)
		const b00 = a00 * a11 - a01 * a10
		const b01 = a00 * a12 - a02 * a10
		const b02 = a00 * a13 - a03 * a10
		const b03 = a01 * a12 - a02 * a11
		const b04 = a01 * a13 - a03 * a11
		const b05 = a02 * a13 - a03 * a12
		const b06 = a20 * a31 - a21 * a30
		const b07 = a20 * a32 - a22 * a30
		const b08 = a20 * a33 - a23 * a30
		const b09 = a21 * a32 - a22 * a31
		const b10 = a21 * a33 - a23 * a31
		const b11 = a22 * a33 - a23 * a32
		const determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
		if (determinant === 0) return false
		const inverse = 1 / determinant
		e[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inverse
		e[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inverse
		e[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inverse
		e[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inverse
		e[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inverse
		e[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inverse
		e[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inverse
		e[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inverse
		e[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inverse
		e[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inverse
		e[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inverse
		e[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inverse
		e[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inverse
		e[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inverse
		e[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inverse
		e[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inverse
		return true
	}

	/**
	 * Transforms a point in place. The matrix is assumed to be affine.
	 */
	transformPoint(point: Vec3): Vec3 {
		const e = this.elements
		const { x, y, z } = point
		return point.set(
			at(e, 0) * x + at(e, 4) * y + at(e, 8) * z + at(e, 12),
			at(e, 1) * x + at(e, 5) * y + at(e, 9) * z + at(e, 13),
			at(e, 2) * x + at(e, 6) * y + at(e, 10) * z + at(e, 14)
		)
	}

	getTranslation(out: Vec3): Vec3 {
		return out.set(at(this.elements, 12), at(this.elements, 13), at(this.elements, 14))
	}

	equals(other: Mat4, epsilon = EPSILON): boolean {
		for (let i = 0; i < 16; i++) {
			if (Math.abs(at(this.elements, i) - at(other.elements, i)) > epsilon) return false
		}
		return true
	}
}
