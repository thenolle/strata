import { ease } from './easing.ts'

/** Fires after a duration of game time. Call update(ctx.dt) every step. */
export class Timer {
	#elapsed = 0
	#fired = false

	constructor(readonly duration: number, readonly repeat = false) {}

	get progress(): number {
		return this.duration <= 0 ? 1 : Math.min(1, this.#elapsed / this.duration)
	}
	/** Returns true on the step the timer fires. */
	update(dt: number): boolean {
		if (!this.repeat && this.#fired) return false
		this.#elapsed += dt
		if (this.#elapsed < this.duration) return false
		this.#elapsed = this.repeat ? this.#elapsed - this.duration : this.duration
		this.#fired = true
		return true
	}
	reset(): void {
		this.#elapsed = 0
		this.#fired = false
	}
}

export class Stopwatch {
	#seconds = 0

	get seconds(): number {
		return this.#seconds
	}
	update(dt: number): number {
		this.#seconds += dt
		return this.#seconds
	}
	reset(): void {
		this.#seconds = 0
	}
}

/** Moves a number from one value to another over time with a named easing such as "outCubic". */
export class Tween {
	#elapsed = 0

	constructor(readonly from: number, readonly to: number, readonly duration: number, readonly easing = 'linear') {}

	get progress(): number {
		return this.duration <= 0 ? 1 : Math.min(1, this.#elapsed / this.duration)
	}
	get value(): number {
		return this.from + (this.to - this.from) * ease(this.easing, this.progress)
	}
	get done(): boolean {
		return this.progress >= 1
	}
	update(dt: number): number {
		this.#elapsed += dt
		return this.value
	}
	reset(): void {
		this.#elapsed = 0
	}
}

/** Runs actions at points in time. Call update(ctx.dt) every step. */
export class Timeline {
	#time = 0
	readonly #events: { readonly at: number; readonly action: () => void; done: boolean }[] = []

	schedule(at: number, action: () => void): this {
		this.#events.push({ at, action, done: false })
		this.#events.sort((a, b) => a.at - b.at)
		return this
	}
	update(dt: number): void {
		this.#time += dt
		for (const event of this.#events) {
			if (!event.done && event.at <= this.#time) {
				event.done = true
				event.action()
			}
		}
	}
}

/** The average of the last size values. */
export class MovingAverage {
	readonly #values: number[] = []

	constructor(readonly size: number) {}

	push(value: number): number {
		this.#values.push(value)
		if (this.#values.length > this.size) this.#values.shift()
		return this.value
	}
	get value(): number {
		return this.#values.length === 0 ? 0 : this.#values.reduce((total, item) => total + item, 0) / this.#values.length
	}
}

/** Exponential smoothing: a small alpha reacts slowly, 1 follows every value. */
export class Ema {
	#value: number | undefined

	constructor(readonly alpha = 0.2) {}

	push(value: number): number {
		this.#value = this.#value === undefined ? value : this.#value + (value - this.#value) * this.alpha
		return this.#value
	}
}
