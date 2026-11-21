/**
 * Tracks which inputs are held, plus which were pressed or released since the previous commit.
 * A press and release inside one frame still reports both edges.
 */
export class EdgeTracker<T> {
	readonly #down = new Set<T>()
	readonly #pressed = new Set<T>()
	readonly #released = new Set<T>()
	readonly #pendingPressed = new Set<T>()
	readonly #pendingReleased = new Set<T>()

	get down(): ReadonlySet<T> {
		return this.#down
	}

	get pressed(): ReadonlySet<T> {
		return this.#pressed
	}

	press(value: T): boolean {
		if (this.#down.has(value)) return false
		this.#down.add(value)
		this.#pendingPressed.add(value)
		return true
	}

	release(value: T): boolean {
		if (!this.#down.delete(value)) return false
		this.#pendingReleased.add(value)
		return true
	}

	releaseAll(): void {
		for (const value of [...this.#down]) this.release(value)
	}

	commit(): void {
		this.#pressed.clear()
		this.#released.clear()
		for (const value of this.#pendingPressed) this.#pressed.add(value)
		for (const value of this.#pendingReleased) this.#released.add(value)
		this.#pendingPressed.clear()
		this.#pendingReleased.clear()
	}

	isDown(value: T): boolean {
		return this.#down.has(value)
	}

	wasPressed(value: T): boolean {
		return this.#pressed.has(value)
	}

	wasReleased(value: T): boolean {
		return this.#released.has(value)
	}
}
