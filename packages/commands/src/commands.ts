import { Emitter, StrataError, err, ok, toDisposable, type Disposable, type Result } from '@strata/core'
import { evaluateWhen, parseWhen, type ContextKeys, type ContextValue, type WhenNode } from './context.ts'

export interface CommandDefinition {
	readonly id: string
	readonly title: string
	readonly category?: string
	/**
	 * Context condition under which the command is available.
	 */
	readonly when?: string
	run(args?: unknown): void | Promise<void>
}

interface Registered {
	readonly definition: CommandDefinition
	readonly when: WhenNode | undefined
}

export interface ListOptions {
	readonly enabledOnly?: boolean
}

/**
 * Named actions that menus, shortcuts and the command palette all invoke the same way.
 */
export class CommandRegistry {
	readonly changed = new Emitter<void>()
	readonly #contexts: ContextKeys
	readonly #commands = new Map<string, Registered>()

	constructor(contexts: ContextKeys) {
		this.#contexts = contexts
	}

	register(definition: CommandDefinition): Disposable {
		if (this.#commands.has(definition.id)) throw new StrataError('conflict', `Command "${definition.id}" is already registered`)
		let when: WhenNode | undefined
		if (definition.when !== undefined) {
			const parsed = parseWhen(definition.when)
			if (!parsed.ok) throw parsed.error
			when = parsed.value
		}
		this.#commands.set(definition.id, { definition, when })
		this.changed.emit()
		return toDisposable(() => {
			if (this.#commands.delete(definition.id)) this.changed.emit()
		})
	}

	has(id: string): boolean {
		return this.#commands.has(id)
	}

	get(id: string): CommandDefinition | undefined {
		return this.#commands.get(id)?.definition
	}

	/**
	 * Whether the command's condition holds. A lookup can supply context values that differ from the live ones,
	 * for example those of a menu opened on a specific target.
	 */
	isEnabled(id: string, lookup?: (name: string) => ContextValue): boolean {
		const entry = this.#commands.get(id)
		if (entry === undefined) return false
		return entry.when === undefined || evaluateWhen(entry.when, lookup ?? ((name) => this.#contexts.get(name)))
	}

	/**
	 * Commands sorted by category then title.
	 */
	list(options: ListOptions = {}): CommandDefinition[] {
		return [...this.#commands.values()]
			.filter((entry) => options.enabledOnly !== true || entry.when === undefined || this.#contexts.evaluate(entry.when))
			.map((entry) => entry.definition)
			.sort((a, b) => `${a.category ?? ''}\u0000${a.title}`.localeCompare(`${b.category ?? ''}\u0000${b.title}`))
	}

	async execute(id: string, args?: unknown): Promise<Result<void>> {
		const entry = this.#commands.get(id)
		if (entry === undefined) return err(new StrataError('not-found', `Unknown command "${id}"`))
		if (entry.when !== undefined && !this.#contexts.evaluate(entry.when)) {
			return err(new StrataError('conflict', `Command "${id}" is not available right now`))
		}
		try {
			await entry.definition.run(args)
			return ok(undefined)
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error)
			return err(new StrataError('command-failed', `Command "${id}" failed: ${message}`, { cause: error }))
		}
	}
}
