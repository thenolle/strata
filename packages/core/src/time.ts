import { StrataError } from './errors.ts'

/**
 * Converts variable frame times into fixed simulation steps. Falling too far behind drops the excess
 * instead of spiralling, and the returned alpha is the interpolation factor for rendering.
 */
export class FixedTimestep {
	readonly step: number
	readonly #maxStepsPerFrame: number
	#accumulator = 0

	constructor(hz = 60, maxStepsPerFrame = 5) {
		if (!Number.isFinite(hz) || hz <= 0) throw new StrataError('invalid-argument', 'Timestep rate must be positive')
		if (!Number.isInteger(maxStepsPerFrame) || maxStepsPerFrame < 1) throw new StrataError('invalid-argument', 'Max steps per frame must be a positive integer')
		this.step = 1 / hz
		this.#maxStepsPerFrame = maxStepsPerFrame
	}

	advance(frameSeconds: number, tick: (step: number) => void): number {
		this.#accumulator += Number.isFinite(frameSeconds) ? Math.max(0, frameSeconds) : 0
		let steps = 0
		while (this.#accumulator >= this.step && steps < this.#maxStepsPerFrame) {
			tick(this.step)
			this.#accumulator -= this.step
			steps++
		}
		if (this.#accumulator >= this.step) this.#accumulator %= this.step
		return this.#accumulator / this.step
	}

	reset(): void {
		this.#accumulator = 0
	}
}
