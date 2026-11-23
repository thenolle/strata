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
