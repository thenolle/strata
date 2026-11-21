/**
 * One reversible edit. `execute` applies it (also used to redo) and `undo` reverses it.
 * Commands with the same `mergeKey` can fold into one step when `merge` returns the combined command.
 */
export interface UndoableCommand {
	readonly kind: string
	readonly label: string
	readonly mergeKey?: string
	execute(): void
	undo(): void
	merge?(next: UndoableCommand): UndoableCommand | undefined
}

interface Entry {
	id: number
	command: UndoableCommand
	at: number
	sealed: boolean
}

export interface HistoryOptions {
	readonly limit?: number
	readonly mergeWindowMs?: number
	readonly now?: () => number
}

/**
 * Undo and redo stacks with merging of continuous edits and tracking of the last saved position.
 */
export class History {
	readonly #limit: number
	readonly #window: number
	readonly #now: () => number
	readonly #undoStack: Entry[] = []
	#redoStack: Entry[] = []
	#nextId = 1
	#cleanId = 0

	constructor(options: HistoryOptions = {}) {
		this.#limit = options.limit ?? 200
		this.#window = options.mergeWindowMs ?? 500
		this.#now = options.now ?? Date.now
	}

	get canUndo(): boolean {
		return this.#undoStack.length > 0
	}

	get canRedo(): boolean {
		return this.#redoStack.length > 0
	}

	get undoLabel(): string | undefined {
		return this.#undoStack[this.#undoStack.length - 1]?.command.label
	}

	get redoLabel(): string | undefined {
		return this.#redoStack[this.#redoStack.length - 1]?.command.label
	}

	/**
	 * True when the current position differs from the last `markClean`.
	 */
	get dirty(): boolean {
		return this.#topId() !== this.#cleanId
	}

	run(command: UndoableCommand): void {
		command.execute()
		if (this.#redoStack.some((entry) => entry.id === this.#cleanId)) this.#cleanId = -1
		this.#redoStack = []
		const now = this.#now()
		const top = this.#undoStack[this.#undoStack.length - 1]
		if (top !== undefined && !top.sealed && command.mergeKey !== undefined && top.command.mergeKey === command.mergeKey && now - top.at <= this.#window) {
			const merged = top.command.merge?.(command)
			if (merged !== undefined) {
				top.command = merged
				top.at = now
				top.id = this.#nextId++
				return
			}
		}
		this.#undoStack.push({ id: this.#nextId++, command, at: now, sealed: false })
		if (this.#undoStack.length > this.#limit) this.#undoStack.shift()
	}

	/**
	 * Stops the latest step from absorbing further edits.
	 */
	seal(): void {
		const top = this.#undoStack[this.#undoStack.length - 1]
		if (top !== undefined) top.sealed = true
	}

	undo(): UndoableCommand | undefined {
		const entry = this.#undoStack.pop()
		if (entry === undefined) return undefined
		try {
			entry.command.undo()
		} catch (error: unknown) {
			this.#undoStack.push(entry)
			throw error
		}
		entry.sealed = true
		this.#redoStack.push(entry)
		return entry.command
	}

	redo(): UndoableCommand | undefined {
		const entry = this.#redoStack.pop()
		if (entry === undefined) return undefined
		try {
			entry.command.execute()
		} catch (error: unknown) {
			this.#redoStack.push(entry)
			throw error
		}
		entry.sealed = true
		this.#undoStack.push(entry)
		return entry.command
	}

	markClean(): void {
		this.#cleanId = this.#topId()
	}

	clear(): void {
		this.#undoStack.length = 0
		this.#redoStack = []
		this.#cleanId = 0
	}

	#topId(): number {
		return this.#undoStack[this.#undoStack.length - 1]?.id ?? 0
	}
}
