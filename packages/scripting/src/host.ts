import type { Disposable, Entity } from '@strata/core'
import type { ComponentView, InputView, Script, ScriptContext } from './api.ts'

/**
 * What a script host needs from the game it runs in. The game implements this, so scripts never touch the engine directly.
 */
export interface ScriptRuntime {
	readonly input: InputView
	component(entity: Entity, name: string): ComponentView | undefined
	find(name: string): Entity | undefined
	nameOf(entity: Entity): string
	setPosition(entity: Entity, x: number, y: number): void
	log(entity: Entity, values: readonly unknown[]): void
	fail(entity: Entity, hook: string, error: unknown): void
}

interface Mutable {
	dt: number
	time: number
}

interface Attached {
	readonly entity: Entity
	readonly instance: Script
	readonly context: ScriptContext & Mutable
	started: boolean
	failed: boolean
}

/**
 * Runs script instances: `onStart` once before the first update, then `onUpdate` every fixed step.
 * A script that throws is switched off and reported, and the others keep running.
 */
export class ScriptHost implements Disposable {
	readonly #runtime: ScriptRuntime
	readonly #attached: Attached[] = []
	#time = 0

	constructor(runtime: ScriptRuntime) {
		this.#runtime = runtime
	}

	get count(): number {
		return this.#attached.length
	}

	/**
	 * Attaches a script module's default export, either a class (constructed once per entity) or a ready object.
	 */
	attach(entity: Entity, exported: unknown): boolean {
		let instance: unknown
		try {
			instance = typeof exported === 'function' ? new (exported as new () => unknown)() : exported
		} catch (error: unknown) {
			this.#runtime.fail(entity, 'constructor', error)
			return false
		}
		if (typeof instance !== 'object' || instance === null) {
			this.#runtime.fail(entity, 'load', new Error('A script must export a class or an object as its default export'))
			return false
		}
		this.#attached.push({ entity, instance: instance as Script, context: this.#contextFor(entity), started: false, failed: false })
		return true
	}

	update(dt: number): void {
		this.#time += dt
		for (const item of this.#attached) {
			if (item.failed) continue
			item.context.dt = dt
			item.context.time = this.#time
			if (!item.started) {
				item.started = true
				this.#call(item, 'onStart')
			}
			if (!item.failed) this.#call(item, 'onUpdate')
		}
	}

	dispose(): void {
		this.#attached.length = 0
	}

	#call(item: Attached, hook: 'onStart' | 'onUpdate'): void {
		const handler = item.instance[hook]
		if (typeof handler !== 'function') return
		try {
			handler.call(item.instance, item.context)
		} catch (error: unknown) {
			item.failed = true
			this.#runtime.fail(item.entity, hook, error)
		}
	}

	#contextFor(entity: Entity): ScriptContext & Mutable {
		const runtime = this.#runtime
		return {
			entity,
			name: runtime.nameOf(entity),
			dt: 0,
			time: 0,
			input: runtime.input,
			get: (component) => runtime.component(entity, component),
			has: (component) => runtime.component(entity, component) !== undefined,
			find: (name) => runtime.find(name),
			getOf: (other, component) => runtime.component(other as Entity, component),
			setPosition: (x, y) => runtime.setPosition(entity, x, y),
			log: (...values) => runtime.log(entity, values)
		}
	}
}
