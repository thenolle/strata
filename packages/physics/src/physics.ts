import type { ComponentData, Entity, World } from '@strata/core'
import { Transform } from '@strata/scene'
import { Body, Collider } from './components.ts'

const SLOP = 0.01
const CORRECTION = 0.8
const REST_SPEED = 30
const GROUND_NORMAL = 0.7

export interface PhysicsOptions {
	readonly gravityX?: number
	readonly gravityY?: number
	readonly iterations?: number
	/** Receives each moved body's new local position. */
	readonly setPosition: (entity: Entity, x: number, y: number) => void
}

type BodyData = ComponentData<(typeof Body)['schema']>

interface Item {
	readonly entity: Entity
	readonly body: BodyData
	x: number
	y: number
	readonly circle: boolean
	readonly hw: number
	readonly hh: number
	readonly dynamic: boolean
	readonly moving: boolean
	readonly invMass: number
}

interface Manifold {
	readonly nx: number
	readonly ny: number
	readonly depth: number
}

interface Contact extends Manifold {
	readonly a: Item
	readonly b: Item
}

function clamp(value: number, min: number, max: number): number {
	return value < min ? min : value > max ? max : value
}

function boxCircle(box: Item, circle: Item): Manifold | undefined {
	const radius = circle.hw
	const dx = circle.x - clamp(circle.x, box.x - box.hw, box.x + box.hw)
	const dy = circle.y - clamp(circle.y, box.y - box.hh, box.y + box.hh)
	const d2 = dx * dx + dy * dy
	if (d2 > 0) {
		if (d2 >= radius * radius) return undefined
		const d = Math.sqrt(d2)
		return { nx: dx / d, ny: dy / d, depth: radius - d }
	}
	const left = circle.x - (box.x - box.hw)
	const right = box.x + box.hw - circle.x
	const bottom = circle.y - (box.y - box.hh)
	const top = box.y + box.hh - circle.y
	const least = Math.min(left, right, bottom, top)
	if (least === left) return { nx: -1, ny: 0, depth: left + radius }
	if (least === right) return { nx: 1, ny: 0, depth: right + radius }
	if (least === bottom) return { nx: 0, ny: -1, depth: bottom + radius }
	return { nx: 0, ny: 1, depth: top + radius }
}

/**
 * Overlap of two shapes, with the normal pointing from `a` to `b`.
 */
function collide(a: Item, b: Item): Manifold | undefined {
	if (a.circle && b.circle) {
		const dx = b.x - a.x
		const dy = b.y - a.y
		const radius = a.hw + b.hw
		const d2 = dx * dx + dy * dy
		if (d2 >= radius * radius) return undefined
		const d = Math.sqrt(d2)
		return d > 0 ? { nx: dx / d, ny: dy / d, depth: radius - d } : { nx: 0, ny: 1, depth: radius }
	}
	if (!a.circle && !b.circle) {
		const dx = b.x - a.x
		const dy = b.y - a.y
		const px = a.hw + b.hw - Math.abs(dx)
		const py = a.hh + b.hh - Math.abs(dy)
		if (px <= 0 || py <= 0) return undefined
		return px < py ? { nx: dx < 0 ? -1 : 1, ny: 0, depth: px } : { nx: 0, ny: dy < 0 ? -1 : 1, depth: py }
	}
	if (!a.circle) return boxCircle(a, b)
	const flipped = boxCircle(b, a)
	return flipped === undefined ? undefined : { nx: -flipped.nx, ny: -flipped.ny, depth: flipped.depth }
}

function applyImpulse(contact: Contact, normalImpulse: number, tangentImpulse: number, tx: number, ty: number): void {
	const { a, b, nx, ny } = contact
	a.body.vx -= (normalImpulse * nx + tangentImpulse * tx) * a.invMass
	a.body.vy -= (normalImpulse * ny + tangentImpulse * ty) * a.invMass
	b.body.vx += (normalImpulse * nx + tangentImpulse * tx) * b.invMass
	b.body.vy += (normalImpulse * ny + tangentImpulse * ty) * b.invMass
}

function solve(contact: Contact): void {
	const { a, b, nx, ny } = contact
	const inverse = a.invMass + b.invMass
	if (inverse === 0) return
	const vn = (b.body.vx - a.body.vx) * nx + (b.body.vy - a.body.vy) * ny
	if (vn > 0) return
	const bounce = vn < -REST_SPEED ? Math.max(a.body.restitution, b.body.restitution) : 0
	const normalImpulse = (-(1 + bounce) * vn) / inverse
	applyImpulse(contact, normalImpulse, 0, 0, 0)
	const tx = -ny
	const ty = nx
	const vt = (b.body.vx - a.body.vx) * tx + (b.body.vy - a.body.vy) * ty
	const limit = normalImpulse * Math.sqrt(Math.max(0, a.body.friction) * Math.max(0, b.body.friction))
	applyImpulse(contact, 0, clamp(-vt / inverse, -limit, limit), tx, ty)
}

/**
 * Fixed-step 2D rigid body simulation: gravity, semi-implicit Euler integration, sweep-and-prune broadphase,
 * box and circle collisions, and iterated impulses with friction and restitution. Uses only basic arithmetic and `Math.sqrt`, so it is deterministic.
 */
export class Physics {
	readonly #world: World
	readonly #gx: number
	readonly #gy: number
	readonly #iterations: number
	readonly #setPosition: PhysicsOptions['setPosition']

	constructor(world: World, options: PhysicsOptions) {
		this.#world = world
		this.#gx = options.gravityX ?? 0
		this.#gy = options.gravityY ?? -900
		this.#iterations = options.iterations ?? 6
		this.#setPosition = options.setPosition
	}

	step(dt: number): void {
		if (!(dt > 0)) return
		const items = this.#gather()
		for (const item of items) {
			item.body.grounded = 0
			if (item.dynamic) {
				item.body.vx += this.#gx * item.body.gravityScale * dt
				item.body.vy += this.#gy * item.body.gravityScale * dt
			}
			if (item.moving) {
				item.x += item.body.vx * dt
				item.y += item.body.vy * dt
			}
		}
		const contacts = this.#detect(items)
		for (let pass = 0; pass < this.#iterations; pass++) {
			for (const contact of contacts) solve(contact)
		}
		for (const contact of contacts) {
			const { a, b, nx, ny } = contact
			const inverse = a.invMass + b.invMass
			if (inverse > 0) {
				const push = (Math.max(contact.depth - SLOP, 0) / inverse) * CORRECTION
				a.x -= nx * push * a.invMass
				a.y -= ny * push * a.invMass
				b.x += nx * push * b.invMass
				b.y += ny * push * b.invMass
			}
			if (a.dynamic && ny < -GROUND_NORMAL) a.body.grounded = 1
			if (b.dynamic && ny > GROUND_NORMAL) b.body.grounded = 1
		}
		for (const item of items) {
			if (item.moving) this.#setPosition(item.entity, item.x, item.y)
		}
	}

	#gather(): Item[] {
		const items: Item[] = []
		for (const entity of this.#world.query(Body, Collider, Transform)) {
			const body = this.#world.require(entity, Body)
			const collider = this.#world.require(entity, Collider)
			const transform = this.#world.require(entity, Transform)
			const sx = Math.abs(transform.sx)
			const sy = Math.abs(transform.sy)
			const circle = collider.shape === 'circle'
			const radius = collider.radius * Math.max(sx, sy)
			const dynamic = body.kind === 'dynamic'
			items.push({
				entity,
				body,
				x: transform.x,
				y: transform.y,
				circle,
				hw: circle ? radius : (collider.width * sx) / 2,
				hh: circle ? radius : (collider.height * sy) / 2,
				dynamic,
				moving: dynamic || body.kind === 'kinematic',
				invMass: dynamic && body.mass > 0 ? 1 / body.mass : 0
			})
		}
		return items
	}

	#detect(items: readonly Item[]): Contact[] {
		const order = [...items].sort((p, q) => p.x - p.hw - (q.x - q.hw))
		const contacts: Contact[] = []
		for (let i = 0; i < order.length; i++) {
			const a = order[i]
			if (a === undefined) continue
			for (let j = i + 1; j < order.length; j++) {
				const b = order[j]
				if (b === undefined || b.x - b.hw > a.x + a.hw) break
				if (a.invMass === 0 && b.invMass === 0) continue
				if (Math.abs(b.y - a.y) > a.hh + b.hh) continue
				const manifold = collide(a, b)
				if (manifold !== undefined) contacts.push({ a, b, ...manifold })
			}
		}
		return contacts
	}
}
