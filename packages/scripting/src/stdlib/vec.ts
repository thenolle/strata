/** An immutable 2D vector. Every method returns a new vector. */
export class Vec2 {
	static readonly zero = new Vec2(0, 0)
	static readonly one = new Vec2(1, 1)
	static readonly up = new Vec2(0, 1)
	static readonly down = new Vec2(0, -1)
	static readonly left = new Vec2(-1, 0)
	static readonly right = new Vec2(1, 0)
	readonly x: number
	readonly y: number

	constructor(x = 0, y = 0) {
		this.x = x
		this.y = y
	}

	static from(value: { readonly x: number; readonly y: number }): Vec2 {
		return new Vec2(value.x, value.y)
	}

	static fromAngle(radians: number, length = 1): Vec2 {
		return new Vec2(Math.cos(radians) * length, Math.sin(radians) * length)
	}

	add(v: Vec2): Vec2 {
		return new Vec2(this.x + v.x, this.y + v.y)
	}
	sub(v: Vec2): Vec2 {
		return new Vec2(this.x - v.x, this.y - v.y)
	}
	mul(scalar: number): Vec2 {
		return new Vec2(this.x * scalar, this.y * scalar)
	}
	div(scalar: number): Vec2 {
		return new Vec2(this.x / scalar, this.y / scalar)
	}
	/** Component-wise product. */
	scale(v: Vec2): Vec2 {
		return new Vec2(this.x * v.x, this.y * v.y)
	}
	negate(): Vec2 {
		return new Vec2(-this.x, -this.y)
	}
	dot(v: Vec2): number {
		return this.x * v.x + this.y * v.y
	}
	/** The z component of the 3D cross product. */
	cross(v: Vec2): number {
		return this.x * v.y - this.y * v.x
	}
	len(): number {
		return Math.hypot(this.x, this.y)
	}
	lenSq(): number {
		return this.x * this.x + this.y * this.y
	}
	dist(v: Vec2): number {
		return Math.hypot(this.x - v.x, this.y - v.y)
	}
	distSq(v: Vec2): number {
		return (this.x - v.x) ** 2 + (this.y - v.y) ** 2
	}
	normalized(): Vec2 {
		const length = this.len()
		return length === 0 ? Vec2.zero : this.div(length)
	}
	limit(max: number): Vec2 {
		return this.lenSq() > max * max ? this.normalized().mul(max) : this
	}
	clampLength(min: number, max: number): Vec2 {
		const length = this.len()
		return length === 0 ? this : this.mul(Math.min(Math.max(length, min), max) / length)
	}
	lerp(v: Vec2, t: number): Vec2 {
		return new Vec2(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t)
	}
	moveTowards(target: Vec2, maxDelta: number): Vec2 {
		const delta = target.sub(this)
		const length = delta.len()
		return length <= maxDelta || length === 0 ? target : this.add(delta.mul(maxDelta / length))
	}
	rotate(radians: number): Vec2 {
		const cos = Math.cos(radians)
		const sin = Math.sin(radians)
		return new Vec2(this.x * cos - this.y * sin, this.x * sin + this.y * cos)
	}
	angle(): number {
		return Math.atan2(this.y, this.x)
	}
	angleTo(v: Vec2): number {
		return Math.atan2(this.cross(v), this.dot(v))
	}
	perp(): Vec2 {
		return new Vec2(-this.y, this.x)
	}
	reflect(normal: Vec2): Vec2 {
		return this.sub(normal.mul(2 * this.dot(normal)))
	}
	project(onto: Vec2): Vec2 {
		const length = onto.lenSq()
		return length === 0 ? Vec2.zero : onto.mul(this.dot(onto) / length)
	}
	equals(v: Vec2, epsilon = 1e-6): boolean {
		return Math.abs(this.x - v.x) <= epsilon && Math.abs(this.y - v.y) <= epsilon
	}
	toString(): string {
		return `(${this.x}, ${this.y})`
	}
}

/** An immutable 3D vector. */
export class Vec3 {
	static readonly zero = new Vec3(0, 0, 0)
	static readonly one = new Vec3(1, 1, 1)
	readonly x: number
	readonly y: number
	readonly z: number

	constructor(x = 0, y = 0, z = 0) {
		this.x = x
		this.y = y
		this.z = z
	}

	add(v: Vec3): Vec3 {
		return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z)
	}
	sub(v: Vec3): Vec3 {
		return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z)
	}
	mul(scalar: number): Vec3 {
		return new Vec3(this.x * scalar, this.y * scalar, this.z * scalar)
	}
	dot(v: Vec3): number {
		return this.x * v.x + this.y * v.y + this.z * v.z
	}
	cross(v: Vec3): Vec3 {
		return new Vec3(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x)
	}
	len(): number {
		return Math.hypot(this.x, this.y, this.z)
	}
	dist(v: Vec3): number {
		return this.sub(v).len()
	}
	normalized(): Vec3 {
		const length = this.len()
		return length === 0 ? Vec3.zero : this.mul(1 / length)
	}
	lerp(v: Vec3, t: number): Vec3 {
		return new Vec3(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t)
	}
	toString(): string {
		return `(${this.x}, ${this.y}, ${this.z})`
	}
}
