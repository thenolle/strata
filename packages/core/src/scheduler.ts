import { StrataError } from './errors.ts'

export interface SystemDefinition<C> {
	readonly name: string
	readonly stage: string
	readonly after?: readonly string[]
	run(context: C): void
}

/**
 * Runs systems in fixed stage order. Inside a stage, systems run in registration order adjusted by their `after`
 * dependencies, which must name systems of the same stage. Invalid schedules fail before anything runs.
 */
export class Scheduler<C> {
	readonly #stages: readonly string[]
	readonly #systems = new Map<string, SystemDefinition<C>>()
	#order: ReadonlyMap<string, readonly SystemDefinition<C>[]> | undefined

	constructor(stages: readonly string[]) {
		if (stages.length === 0 || new Set(stages).size !== stages.length) {
			throw new StrataError('invalid-schedule', 'Stages must be unique and non-empty')
		}
		this.#stages = [...stages]
	}

	get stages(): readonly string[] {
		return this.#stages
	}

	add(system: SystemDefinition<C>): void {
		if (!this.#stages.includes(system.stage)) throw new StrataError('invalid-schedule', `Unknown stage "${system.stage}"`)
		if (this.#systems.has(system.name)) throw new StrataError('invalid-schedule', `Duplicate system "${system.name}"`)
		this.#systems.set(system.name, system)
		this.#order = undefined
	}

	order(stage: string): readonly string[] {
		return this.#resolve().get(stage)?.map((system) => system.name) ?? []
	}

	run(stage: string, context: C): void {
		const systems = this.#resolve().get(stage)
		if (systems === undefined) throw new StrataError('invalid-schedule', `Unknown stage "${stage}"`)
		for (const system of systems) system.run(context)
	}

	runAll(context: C): void {
		for (const stage of this.#stages) this.run(stage, context)
	}

	#resolve(): ReadonlyMap<string, readonly SystemDefinition<C>[]> {
		if (this.#order !== undefined) return this.#order
		const order = new Map<string, readonly SystemDefinition<C>[]>()
		for (const stage of this.#stages) order.set(stage, this.#sort(stage))
		this.#order = order
		return order
	}

	#sort(stage: string): SystemDefinition<C>[] {
		const pending = [...this.#systems.values()].filter((system) => system.stage === stage)
		const names = new Set(pending.map((system) => system.name))
		for (const system of pending) {
			for (const dependency of system.after ?? []) {
				if (!names.has(dependency)) {
					throw new StrataError('invalid-schedule', `System "${system.name}" runs after "${dependency}", which is not in stage "${stage}"`)
				}
			}
		}
		const done = new Set<string>()
		const sorted: SystemDefinition<C>[] = []
		while (pending.length > 0) {
			const index = pending.findIndex((system) => (system.after ?? []).every((dependency) => done.has(dependency)))
			const next = pending[index]
			if (next === undefined) {
				throw new StrataError('invalid-schedule', `Circular dependency in stage "${stage}": ${pending.map((system) => system.name).join(', ')}`)
			}
			pending.splice(index, 1)
			done.add(next.name)
			sorted.push(next)
		}
		return sorted
	}
}
