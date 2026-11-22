/** A min-heap: pop returns the value with the smallest priority. */
export class PriorityQueue<T> {
	readonly #items: { readonly value: T; readonly priority: number }[] = []

	get size(): number {
		return this.#items.length
	}

	push(value: T, priority: number): void {
		const items = this.#items
		items.push({ value, priority })
		let index = items.length - 1
		while (index > 0) {
			const parent = (index - 1) >> 1
			const a = items[index]
			const b = items[parent]
			if (a === undefined || b === undefined || b.priority <= a.priority) break
			items[index] = b
			items[parent] = a
			index = parent
		}
	}

	pop(): T | undefined {
		const items = this.#items
		const top = items[0]
		const last = items.pop()
		if (top === undefined || last === undefined) return undefined
		if (items.length > 0) {
			items[0] = last
			let index = 0
			for (;;) {
				const left = index * 2 + 1
				const right = left + 1
				let smallest = index
				if ((items[left]?.priority ?? Infinity) < (items[smallest]?.priority ?? Infinity)) smallest = left
				if ((items[right]?.priority ?? Infinity) < (items[smallest]?.priority ?? Infinity)) smallest = right
				if (smallest === index) break
				const a = items[index]
				const b = items[smallest]
				if (a === undefined || b === undefined) break
				items[index] = b
				items[smallest] = a
				index = smallest
			}
		}
		return top.value
	}
}

/** A fixed-size buffer that overwrites the oldest value when full. */
export class RingBuffer<T> {
	readonly #items: (T | undefined)[]
	#start = 0
	#count = 0

	constructor(readonly capacity: number) {
		this.#items = new Array<T | undefined>(Math.max(1, capacity))
	}

	get size(): number {
		return this.#count
	}

	push(value: T): void {
		this.#items[(this.#start + this.#count) % this.#items.length] = value
		if (this.#count < this.#items.length) this.#count++
		else this.#start = (this.#start + 1) % this.#items.length
	}

	toArray(): T[] {
		const out: T[] = []
		for (let index = 0; index < this.#count; index++) out.push(this.#items[(this.#start + index) % this.#items.length] as T)
		return out
	}
}

/** A width by height grid of values. Out-of-range reads return undefined. */
export class Grid2D<T> {
	readonly #cells: T[]

	constructor(readonly width: number, readonly height: number, fill: T) {
		this.#cells = new Array<T>(width * height).fill(fill)
	}

	inside(x: number, y: number): boolean {
		return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height
	}
	get(x: number, y: number): T | undefined {
		return this.inside(x, y) ? this.#cells[y * this.width + x] : undefined
	}
	set(x: number, y: number, value: T): void {
		if (this.inside(x, y)) this.#cells[y * this.width + x] = value
	}
	neighbors(x: number, y: number, diagonal = false): [number, number][] {
		const out: [number, number][] = []
		for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				if ((dx === 0 && dy === 0) || (!diagonal && dx !== 0 && dy !== 0)) continue
				if (this.inside(x + dx, y + dy)) out.push([x + dx, y + dy])
			}
		}
		return out
	}
}

/**
 * Finds the shortest path on a grid with A*. Returns the cells from start to goal, or undefined when the goal cannot be reached.
 * Diagonal moves never cut corners.
 */
export function astar(
	width: number,
	height: number,
	start: readonly [number, number],
	goal: readonly [number, number],
	walkable: (x: number, y: number) => boolean,
	options: { readonly diagonal?: boolean } = {}
): [number, number][] | undefined {
	const [sx, sy] = start
	const [gx, gy] = goal
	const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height
	if (!inside(sx, sy) || !inside(gx, gy) || !walkable(sx, sy) || !walkable(gx, gy)) return undefined
	const diagonal = options.diagonal === true
	const cost = new Float64Array(width * height).fill(Infinity)
	const from = new Int32Array(width * height).fill(-1)
	const closed = new Uint8Array(width * height)
	const open = new PriorityQueue<number>()
	const heuristic = (x: number, y: number): number => {
		const dx = Math.abs(x - gx)
		const dy = Math.abs(y - gy)
		return diagonal ? Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy) : dx + dy
	}
	cost[sy * width + sx] = 0
	open.push(sy * width + sx, 0)
	while (open.size > 0) {
		const current = open.pop() ?? -1
		if (current < 0 || closed[current] === 1) continue
		closed[current] = 1
		const cx = current % width
		const cy = Math.floor(current / width)
		if (cx === gx && cy === gy) {
			const path: [number, number][] = []
			for (let node = current; node >= 0; node = from[node] ?? -1) path.push([node % width, Math.floor(node / width)])
			return path.reverse()
		}
		for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				if ((dx === 0 && dy === 0) || (!diagonal && dx !== 0 && dy !== 0)) continue
				const nx = cx + dx
				const ny = cy + dy
				if (!inside(nx, ny) || !walkable(nx, ny)) continue
				if (dx !== 0 && dy !== 0 && (!walkable(cx + dx, cy) || !walkable(cx, cy + dy))) continue
				const next = ny * width + nx
				const tentative = (cost[current] ?? Infinity) + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1)
				if (tentative < (cost[next] ?? Infinity)) {
					cost[next] = tentative
					from[next] = current
					open.push(next, tentative + heuristic(nx, ny))
				}
			}
		}
	}
	return undefined
}

/** A small event: subscribe with on, which returns a function that unsubscribes. */
export class Signal<Args extends unknown[] = []> {
	readonly #handlers = new Set<(...args: Args) => void>()

	on(handler: (...args: Args) => void): () => void {
		this.#handlers.add(handler)
		return () => this.#handlers.delete(handler)
	}
	emit(...args: Args): void {
		for (const handler of [...this.#handlers]) handler(...args)
	}
}

/** Allows an action at most once per interval of game time (ctx.time). */
export class Cooldown {
	#next = 0

	constructor(readonly seconds: number) {}

	ready(time: number): boolean {
		return time >= this.#next
	}
	/** Returns true and starts the cooldown when it was ready. */
	trigger(time: number): boolean {
		if (time < this.#next) return false
		this.#next = time + this.seconds
		return true
	}
}

/** A spring that pulls a value toward a target with natural overshoot. */
export class Spring {
	value: number
	velocity = 0

	constructor(value = 0, readonly stiffness = 120, readonly damping = 14) {
		this.value = value
	}

	update(target: number, dt: number): number {
		this.velocity += (this.stiffness * (target - this.value) - this.damping * this.velocity) * dt
		this.value += this.velocity * dt
		return this.value
	}
}

/** A state machine: to() switches state and calls the exit and enter handlers. */
export class StateMachine<S extends string> {
	state: S
	readonly #enter = new Map<S, () => void>()
	readonly #exit = new Map<S, () => void>()

	constructor(initial: S) {
		this.state = initial
	}

	onEnter(state: S, handler: () => void): this {
		this.#enter.set(state, handler)
		return this
	}
	onExit(state: S, handler: () => void): this {
		this.#exit.set(state, handler)
		return this
	}
	to(next: S): void {
		if (next === this.state) return
		this.#exit.get(this.state)?.()
		this.state = next
		this.#enter.get(next)?.()
	}
}
