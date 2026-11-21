import type { Entity } from './entity.ts'
import { StrataError } from './errors.ts'

export type FieldKind = 'f32' | 'i32' | 'u32' | 'bool' | 'string' | 'entity'
export type FieldSchema = Readonly<Record<string, FieldKind>>

interface FieldValueMap {
	f32: number
	i32: number
	u32: number
	bool: boolean
	string: string
	entity: Entity
}

export type FieldValue<K extends FieldKind> = FieldValueMap[K]
export type ComponentData<S extends FieldSchema> = { -readonly [K in keyof S]: FieldValue<S[K]> }

/**
 * Anything that identifies a component type.
 */
export interface ComponentHandle {
	readonly name: string
}

/**
 * Typed component declaration. The schema is the single source of truth for validation, inspection and serialization.
 */
export interface ComponentDefinition<S extends FieldSchema = FieldSchema> extends ComponentHandle {
	readonly schema: S
	readonly defaults: ComponentData<S>
}

function isValid(kind: FieldKind, value: unknown): boolean {
	switch (kind) {
		case 'f32': return typeof value === 'number' && Number.isFinite(value)
		case 'i32': return typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
		case 'u32':
		case 'entity': return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4294967295
		case 'bool': return typeof value === 'boolean'
		case 'string': return typeof value === 'string'
	}
}

function asRecord(value: object): Readonly<Record<string, unknown>> {
	return value as Readonly<Record<string, unknown>>
}

/**
 * Builds a validated, independent copy of component data from defaults plus overrides.
 */
export function createComponentData<S extends FieldSchema>(definition: ComponentDefinition<S>, init?: Readonly<Partial<ComponentData<S>>>): ComponentData<S> {
	const overrides = init === undefined ? undefined : asRecord(init)
	const defaults = asRecord(definition.defaults)
	const data: Record<string, unknown> = {}
	for (const [field, kind] of Object.entries(definition.schema)) {
		const value = overrides?.[field] ?? defaults[field]
		if (!isValid(kind, value)) throw new StrataError('invalid-argument', `Component "${definition.name}" field "${field}" expects ${kind}`)
		data[field] = value
	}
	return data as ComponentData<S>
}

/**
 * Declares a component type. Defaults are validated immediately.
 */
export function defineComponent<const S extends FieldSchema>(name: string, schema: S, defaults: ComponentData<S>): ComponentDefinition<S> {
	if (name.length === 0) throw new StrataError('invalid-argument', 'Component name must not be empty')
	const definition: ComponentDefinition<S> = Object.freeze({ name, schema: Object.freeze({ ...schema }), defaults: Object.freeze({ ...defaults }) })
	createComponentData(definition)
	return definition
}
