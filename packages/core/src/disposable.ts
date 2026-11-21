/**
 * Anything that owns a resource and can release it. Calling dispose more than once must be safe.
 */
export interface Disposable {
	dispose(): void
}

/**
 * Wraps a cleanup function as an idempotent disposable.
 */
export function toDisposable(release: () => void): Disposable {
	let released = false
	return {
		dispose(): void {
			if (released) return
			released = true
			release()
		}
	}
}

/**
 * Owns a group of disposables and releases them in reverse order of registration.
 * Every item is released even when some throw; failures are reported together afterwards.
 */
export class DisposableStore implements Disposable {
	readonly #items: Disposable[] = []
	#disposed = false

	get disposed(): boolean {
		return this.#disposed
	}

	add<T extends Disposable>(item: T): T {
		if (this.#disposed) item.dispose()
		else this.#items.push(item)
		return item
	}

	dispose(): void {
		if (this.#disposed) return
		this.#disposed = true
		const failures: unknown[] = []
		for (const item of this.#items.splice(0).reverse()) {
			try {
				item.dispose()
			} catch (error: unknown) {
				failures.push(error)
			}
		}
		if (failures.length > 0) throw new AggregateError(failures, 'One or more resources failed to dispose')
	}
}
