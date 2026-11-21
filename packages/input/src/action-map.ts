import { StrataError, err, ok, type Result } from '@strata/core'
import { bindingsEqual, isBinding, type Binding } from './binding.ts'

export type ActionMapData = Readonly<Record<string, readonly Binding[]>>

const NO_BINDINGS: readonly Binding[] = []

/**
 * Named actions and the physical inputs bound to them. Every mutation bumps `version` so consumers can resync.
 */
export class ActionMap {
	readonly #actions = new Map<string, Binding[]>()
	#version = 0

	constructor(definitions: ActionMapData = {}) {
		for (const [name, bindings] of Object.entries(definitions)) {
			this.#ensure(name)
			for (const binding of bindings) this.bind(name, binding)
		}
	}

	get version(): number {
		return this.#version
	}

	actions(): string[] {
		return [...this.#actions.keys()]
	}

	has(action: string): boolean {
		return this.#actions.has(action)
	}

	bindings(action: string): readonly Binding[] {
		return this.#actions.get(action) ?? NO_BINDINGS
	}

	/**
	 * Adds a binding, creating the action when needed. Returns false when the binding already existed.
	 */
	bind(action: string, binding: Binding): boolean {
		if (!isBinding(binding)) throw new StrataError('invalid-argument', 'Invalid input binding')
		const bindings = this.#ensure(action)
		if (bindings.some((existing) => bindingsEqual(existing, binding))) return false
		bindings.push(binding)
		this.#version++
		return true
	}

	unbind(action: string, binding: Binding): boolean {
		const bindings = this.#actions.get(action)
		const index = bindings?.findIndex((existing) => bindingsEqual(existing, binding)) ?? -1
		if (bindings === undefined || index < 0) return false
		bindings.splice(index, 1)
		this.#version++
		return true
	}

	replace(action: string, bindings: readonly Binding[]): void {
		if (!bindings.every(isBinding)) throw new StrataError('invalid-argument', 'Invalid input binding')
		this.#ensure(action)
		const unique: Binding[] = []
		for (const binding of bindings) {
			if (!unique.some((existing) => bindingsEqual(existing, binding))) unique.push(binding)
		}
		this.#actions.set(action, unique)
		this.#version++
	}

	toData(): ActionMapData {
		const data: Record<string, readonly Binding[]> = {}
		for (const [name, bindings] of this.#actions) data[name] = bindings.map((binding) => ({ ...binding }))
		return data
	}

	/**
	 * Validates and loads persisted bindings, such as a player's settings.
	 */
	static parse(value: unknown): Result<ActionMap> {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) {
			return err(new StrataError('invalid-format', 'Input map must be an object'))
		}
		const map = new ActionMap()
		for (const [name, bindings] of Object.entries(value)) {
			if (name.length === 0 || !Array.isArray(bindings) || !bindings.every(isBinding)) {
				return err(new StrataError('invalid-format', `Invalid bindings for action "${name}"`))
			}
			map.replace(name, bindings)
		}
		return ok(map)
	}

	#ensure(action: string): Binding[] {
		if (action.length === 0) throw new StrataError('invalid-argument', 'Action name must not be empty')
		let bindings = this.#actions.get(action)
		if (bindings === undefined) {
			bindings = []
			this.#actions.set(action, bindings)
			this.#version++
		}
		return bindings
	}
}
