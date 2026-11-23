export type Vec = readonly [number, number, number]

const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const normalize = (a: Vec): Vec => {
	const length = Math.hypot(a[0], a[1], a[2]) || 1
	return [a[0] / length, a[1] / length, a[2] / length]
}
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/** Multiplies two column-major 4x4 matrices: the result applies b first, then a. */
export function multiply(a: Float32Array, b: Float32Array): Float32Array {
	const out = new Float32Array(16)
	for (let column = 0; column < 4; column++) {
		for (let row = 0; row < 4; row++) {
			let sum = 0
			for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[column * 4 + k]!
			out[column * 4 + row] = sum
		}
	}
	return out
}

/** Moves, rotates around z, then scales: the matrix for one entity. */
export function modelMatrix(x: number, y: number, z: number, rotation: number, sx: number, sy: number, sz: number): Float32Array {
	const cos = Math.cos(rotation)
	const sin = Math.sin(rotation)
	return new Float32Array([cos * sx, sin * sx, 0, 0, -sin * sy, cos * sy, 0, 0, 0, 0, sz, 0, x, y, z, 1])
}

/** A camera that orbits a target point, with y up and the 2D scene lying on the z = 0 plane. */
export class OrbitCamera {
	yaw = 0
	pitch = 0.45
	distance = 600
	target: [number, number, number] = [0, 0, 0]
	readonly fov = (50 * Math.PI) / 180

	eye(): Vec {
		const flat = Math.cos(this.pitch)
		return [this.target[0] + this.distance * Math.sin(this.yaw) * flat, this.target[1] + this.distance * Math.sin(this.pitch), this.target[2] + this.distance * Math.cos(this.yaw) * flat]
	}

	basis(): { readonly forward: Vec; readonly right: Vec; readonly up: Vec } {
		const eye = this.eye()
		const forward = normalize([this.target[0] - eye[0], this.target[1] - eye[1], this.target[2] - eye[2]])
		const right = normalize(cross(forward, [0, 1, 0]))
		return { forward, right, up: cross(right, forward) }
	}

	view(): Float32Array {
		const eye = this.eye()
		const { forward, right, up } = this.basis()
		const back: Vec = [-forward[0], -forward[1], -forward[2]]
		return new Float32Array([right[0], up[0], back[0], 0, right[1], up[1], back[1], 0, right[2], up[2], back[2], 0, -dot(right, eye), -dot(up, eye), -dot(back, eye), 1])
	}

	projection(aspect: number): Float32Array {
		const f = 1 / Math.tan(this.fov / 2)
		const near = 1
		const far = 20000
		const out = new Float32Array(16)
		out[0] = f / aspect
		out[5] = f
		out[10] = (far + near) / (near - far)
		out[11] = -1
		out[14] = (2 * far * near) / (near - far)
		return out
	}

	/** The ray through a point of the screen, with x and y in -1..1 and y up. */
	ray(ndcX: number, ndcY: number, aspect: number): { readonly origin: Vec; readonly direction: Vec } {
		const { forward, right, up } = this.basis()
		const tan = Math.tan(this.fov / 2)
		const direction = normalize([
			forward[0] + right[0] * ndcX * tan * aspect + up[0] * ndcY * tan,
			forward[1] + right[1] * ndcX * tan * aspect + up[1] * ndcY * tan,
			forward[2] + right[2] * ndcX * tan * aspect + up[2] * ndcY * tan
		])
		return { origin: this.eye(), direction }
	}

	orbit(dx: number, dy: number): void {
		this.yaw -= dx * 0.008
		this.pitch = clamp(this.pitch + dy * 0.008, -1.5, 1.5)
	}

	pan(dx: number, dy: number, screenHeight: number): void {
		const perPixel = (2 * Math.tan(this.fov / 2) * this.distance) / Math.max(1, screenHeight)
		const { right, up } = this.basis()
		for (let axis = 0; axis < 3; axis++) this.target[axis] = this.target[axis]! - right[axis]! * dx * perPixel + up[axis]! * dy * perPixel
	}

	zoom(deltaY: number): void {
		this.distance = clamp(this.distance * Math.exp(deltaY * 0.001), 20, 8000)
	}

	reset(): void {
		this.yaw = 0
		this.pitch = 0.45
		this.distance = 600
		this.target = [0, 0, 0]
	}

	preset(name: 'persp' | 'front' | 'right' | 'top'): void {
		this.yaw = name === 'right' ? Math.PI / 2 : name === 'persp' ? 0.6 : 0
		this.pitch = name === 'top' ? 1.5 : name === 'persp' ? 0.4 : 0
	}
}

/** Where a ray meets the z = 0 plane, where the 2D scene lies. */
export function planeHit(ray: { readonly origin: Vec; readonly direction: Vec }): { readonly x: number; readonly y: number } | undefined {
	if (Math.abs(ray.direction[2]) < 1e-6) return undefined
	const t = -ray.origin[2] / ray.direction[2]
	return t < 0 ? undefined : { x: ray.origin[0] + ray.direction[0] * t, y: ray.origin[1] + ray.direction[1] * t }
}

/** Whether a point lies inside a rectangle centered at (x, y) and rotated by `rotation` radians. */
export function pointInRect(px: number, py: number, x: number, y: number, width: number, height: number, rotation: number): boolean {
	const dx = px - x
	const dy = py - y
	const cos = Math.cos(rotation)
	const sin = Math.sin(rotation)
	return Math.abs(dx * cos + dy * sin) <= width / 2 && Math.abs(-dx * sin + dy * cos) <= height / 2
}




export const v3 = {
	add: (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
	sub: (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
	scale: (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s],
	length: (a: Vec): number => Math.hypot(a[0], a[1], a[2]),
	dot,
	cross,
	normalize
}

type M16 = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]

/** The inverse of a 4x4 matrix, or undefined when it has none. */
export function invert(m: Float32Array): Float32Array | undefined {
	const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = Array.from(m) as M16
	const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12
	const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32
	let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
	if (Math.abs(det) < 1e-12) return undefined
	det = 1 / det
	return new Float32Array([
		(a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det, (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
		(a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det, (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
		(a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det, (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
		(a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det, (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det
	])
}

export function scaleMatrix(x: number, y: number, z: number): Float32Array {
	return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1])
}

export function transformPoint(m: Float32Array, p: Vec): Vec {
	return [m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!, m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!, m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!]
}

export function transformDirection(m: Float32Array, p: Vec): Vec {
	return [m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2], m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2], m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2]]
}

/** A world point in screen pixels, or undefined when it is behind the camera. */
export function project(viewProjection: Float32Array, p: Vec, width: number, height: number): { readonly x: number; readonly y: number } | undefined {
	const m = viewProjection
	const w = m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!
	if (w <= 0.001) return undefined
	const x = (m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!) / w
	const y = (m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!) / w
	return { x: (x * 0.5 + 0.5) * width, y: (1 - (y * 0.5 + 0.5)) * height }
}

/** Where along a line (origin + s * axis) it comes closest to a ray. Both directions must be unit length. */
export function closestParam(ray: { readonly origin: Vec; readonly direction: Vec }, origin: Vec, axis: Vec): number {
	const w = v3.sub(ray.origin, origin)
	const b = dot(axis, ray.direction)
	const d = dot(ray.direction, w)
	const e = dot(axis, w)
	const denominator = 1 - b * b
	return Math.abs(denominator) < 1e-6 ? 0 : (e - b * d) / denominator
}

/** Distance along a ray to a unit box (from -0.5 to 0.5) after the inverse of its matrix is applied, or undefined for a miss. */
export function rayBox(ray: { readonly origin: Vec; readonly direction: Vec }, inverseModel: Float32Array): number | undefined {
	const origin = transformPoint(inverseModel, ray.origin)
	const direction = transformDirection(inverseModel, ray.direction)
	let near = -Infinity
	let far = Infinity
	for (let axis = 0; axis < 3; axis++) {
		const o = origin[axis]!
		const d = direction[axis]!
		if (Math.abs(d) < 1e-9) {
			if (Math.abs(o) > 0.5) return undefined
			continue
		}
		let t0 = (-0.5 - o) / d
		let t1 = (0.5 - o) / d
		if (t0 > t1) [t0, t1] = [t1, t0]
		near = Math.max(near, t0)
		far = Math.min(far, t1)
		if (near > far) return undefined
	}
	return far < 0 ? undefined : Math.max(near, 0)
}

export type Quat = readonly [number, number, number, number]

export function quatAxisAngle(axis: Vec, angle: number): Quat {
	const s = Math.sin(angle / 2)
	return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]
}

/** The rotation that applies b first, then a. */
export function quatMultiply(a: Quat, b: Quat): Quat {
	const [ax, ay, az, aw] = a
	const [bx, by, bz, bw] = b
	const x = aw * bx + ax * bw + ay * bz - az * by
	const y = aw * by - ax * bz + ay * bw + az * bx
	const z = aw * bz + ax * by - ay * bx + az * bw
	const w = aw * bw - ax * bx - ay * by - az * bz
	const length = Math.hypot(x, y, z, w) || 1
	return [x / length, y / length, z / length, w / length]
}
