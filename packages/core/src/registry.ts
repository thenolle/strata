import type { ComponentDefinition, FieldSchema } from './component.ts'
import { StrataError } from './errors.ts'

/**
 * Maps component names to definitions so persisted data can be resolved. The name "identity" is reserved.
 */
export class ComponentRegistry {
	readonly #byName = new Map<string, ComponentDefinition>()

	register<S extends FieldSchema>(definition: ComponentDefinition<S>): this {
		if (definition.name === 'identity') throw new StrataError('invalid-argument', 'The component name "identity" is reserved')
		const existing = this.#byName.get(definition.name)
		if (existing !== undefined && (existing as unknown) !== (definition as unknown)) {
			throw new StrataError('invalid-argument', `A different component named "${definition.name}" is already registered`)
		}
		this.#byName.set(definition.name, definition as unknown as ComponentDefinition)
		return this
	}

	get(name: string): ComponentDefinition | undefined {
		return this.#byName.get(name)
	}

	definitions(): ComponentDefinition[] {
		return [...this.#byName.values()]
	}
}
