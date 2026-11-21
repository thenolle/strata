import { toDisposable, type Disposable } from './disposable.ts'

export type Listener<T> = (event: T) => void

/**
 * Synchronous typed event source. Listeners run in subscription order; a failing listener does not stop the others,
 * and all failures are rethrown together after delivery.
 */
export class Emitter<T> {
	readonly #listeners = new Set<Listener<T>>()

	get size(): number {
		return this.#listeners.size
	}

	subscribe(listener: Listener<T>): Disposable {
		this.#listeners.add(listener)
		return toDisposable(() => {
			this.#listeners.delete(listener)
		})
	}

	emit(event: T): void {
		if (this.#listeners.size === 0) return
		const failures: unknown[] = []
		for (const listener of Array.from(this.#listeners)) {
			try {
				listener(event)
			} catch (error: unknown) {
				failures.push(error)
			}
		}
		if (failures.length > 0) throw new AggregateError(failures, 'One or more listeners failed')
	}

	clear(): void {
		this.#listeners.clear()
	}
}
