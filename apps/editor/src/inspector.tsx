/** @jsxImportSource @gambrel/view */
import { Button } from '@gambrel/components'
import { effect, onCleanup, signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import type { Entity } from '@strata/core'
import type { EditorSession, RegisteredComponent } from '@strata/editor-core'

interface FieldProps {
	readonly label: string
	readonly revision: () => number
}

const BUILTIN = new Set(['name', 'transform', 'parent', 'sprite'])
const OPTIONS: Readonly<Record<string, readonly string[]>> = {
	'body.kind': ['dynamic', 'static', 'kinematic'],
	'collider.shape': ['box', 'circle'],
	'controller.mode': ['platformer', 'topdown']
}

function format(value: number): string {
	return String(Number(value.toFixed(4)))
}

function definitionsOf(session: EditorSession): RegisteredComponent[] {
	return [...session.registry.definitions()].filter((definition) => !BUILTIN.has(definition.name))
}

function NumberField(props: FieldProps & { readonly read: () => number; readonly write: (value: number) => void }): Child {
	return (
		<label class="field">
			<span>{props.label}</span>
			<input
				type="number"
				step="any"
				ref={(element: Element) => {
					const input = element as HTMLInputElement
					effect(() => {
						props.revision()
						if (document.activeElement !== input) input.value = format(props.read())
					})
					const commit = (): void => {
						if (input.value.trim() === '') return
						const value = Number(input.value)
						if (Number.isFinite(value)) props.write(value)
					}
					input.addEventListener('input', commit)
					onCleanup(() => input.removeEventListener('input', commit))
				}}
			/>
		</label>
	)
}

function TextField(props: FieldProps & { readonly read: () => string; readonly write: (value: string) => void }): Child {
	return (
		<label class="field">
			<span>{props.label}</span>
			<input
				type="text"
				maxlength={128}
				ref={(element: Element) => {
					const input = element as HTMLInputElement
					effect(() => {
						props.revision()
						if (document.activeElement !== input) input.value = props.read()
					})
					const commit = (): void => props.write(input.value)
					input.addEventListener('input', commit)
					onCleanup(() => input.removeEventListener('input', commit))
				}}
			/>
		</label>
	)
}

function SelectField(props: FieldProps & { readonly options: readonly string[]; readonly read: () => string; readonly write: (value: string) => void }): Child {
	return (
		<label class="field">
			<span>{props.label}</span>
			<select
				ref={(element: Element) => {
					const select = element as HTMLSelectElement
					select.replaceChildren(...props.options.map((option) => new Option(option, option)))
					effect(() => {
						props.revision()
						if (document.activeElement !== select) select.value = props.read()
					})
					const commit = (): void => props.write(select.value)
					select.addEventListener('change', commit)
					onCleanup(() => select.removeEventListener('change', commit))
				}}
			></select>
		</label>
	)
}

function SpriteField(props: FieldProps & { readonly session: EditorSession; readonly entity: Entity }): Child {
	return (
		<label class="field">
			<span>Image</span>
			<select
				ref={(element: Element) => {
					const select = element as HTMLSelectElement
					effect(() => {
						props.revision()
						if (document.activeElement === select) return
						const images = props.session.project.assets.list().filter((asset) => asset.kind === 'image')
						select.replaceChildren(new Option('(none)', ''), ...images.map((asset) => new Option(asset.name, asset.id)))
						select.value = props.session.spriteOf(props.entity)
					})
					const commit = (): void => props.session.setSprite(props.entity, select.value)
					select.addEventListener('change', commit)
					onCleanup(() => select.removeEventListener('change', commit))
				}}
			></select>
		</label>
	)
}

function ComponentSection(props: { readonly session: EditorSession; readonly entity: Entity; readonly definition: RegisteredComponent; readonly revision: () => number }): Child {
	const { session, entity, definition, revision } = props
	return (
		<div class="component">
			<div class="component-head">
				<h2>{definition.name}</h2>
				<Button size="sm" variant="ghost" onClick={() => session.setComponent(entity, definition, false)}>
					Remove
				</Button>
			</div>
			{Object.entries(definition.schema).map(([field, kind]) => {
				if (kind === 'entity') return null
				if (kind === 'string') {
					const options = OPTIONS[`${definition.name}.${field}`]
					const read = (): string => String(session.componentValue(entity, definition, field) ?? '')
					const write = (value: string): void => session.setField(entity, definition, field, value)
					return options === undefined ? (
						<TextField label={field} revision={revision} read={read} write={write} />
					) : (
						<SelectField label={field} options={options} revision={revision} read={read} write={write} />
					)
				}
				return (
					<NumberField
						label={field}
						revision={revision}
						read={() => Number(session.componentValue(entity, definition, field) ?? 0)}
						write={(value) => session.setField(entity, definition, field, value)}
					/>
				)
			})}
		</div>
	)
}

function AddComponent(props: { readonly session: EditorSession; readonly entity: Entity; readonly revision: () => number }): Child {
	return (
		<label class="field">
			<span>Add</span>
			<select
				ref={(element: Element) => {
					const select = element as HTMLSelectElement
					effect(() => {
						props.revision()
						if (document.activeElement === select) return
						const missing = definitionsOf(props.session).filter((definition) => !props.session.world.has(props.entity, definition))
						select.replaceChildren(new Option('Add component…', ''), ...missing.map((definition) => new Option(definition.name, definition.name)))
						select.value = ''
					})
					const commit = (): void => {
						const definition = definitionsOf(props.session).find((candidate) => candidate.name === select.value)
						if (definition !== undefined) props.session.setComponent(props.entity, definition, true)
						select.value = ''
					}
					select.addEventListener('change', commit)
					onCleanup(() => select.removeEventListener('change', commit))
				}}
			></select>
		</label>
	)
}

/**
 * Edits the selected entity. Inputs are created once per selection and refreshed through effects,
 * so typing never loses focus while the viewport changes values. Component sections follow the components the entity has.
 */
export function Inspector(props: {
	readonly session: EditorSession
	readonly selected: () => Entity | undefined
	readonly revision: () => number
}): Child {
	const presence = signal('')
	return (
		<div
			class="inspector-body"
			ref={() => {
				effect(() => {
					props.revision()
					const entity = props.selected()
					const next = entity === undefined ? '' : definitionsOf(props.session).filter((definition) => props.session.world.has(entity, definition)).map((definition) => definition.name).join(',')
					if (presence.peek() !== next) presence.set(next)
				})
			}}
		>
			{() => {
				const entity = props.selected()
				if (entity === undefined) return <p class="panel-empty">Select an entity to inspect it.</p>
				const { session, revision } = props
				return (
					<div>
						<h2>Entity</h2>
						<TextField label="Name" revision={revision} read={() => session.nameOf(entity)} write={(value) => session.rename(entity, value)} />
						<h2>Transform</h2>
						<NumberField label="X" revision={revision} read={() => session.getTransform(entity)?.x ?? 0} write={(value) => session.setTransform(entity, { x: value })} />
						<NumberField label="Y" revision={revision} read={() => session.getTransform(entity)?.y ?? 0} write={(value) => session.setTransform(entity, { y: value })} />
						<NumberField label="Rotation" revision={revision} read={() => session.rotationDegrees(entity)} write={(value) => session.setRotationDegrees(entity, value)} />
						<NumberField label="Scale X" revision={revision} read={() => session.getTransform(entity)?.sx ?? 1} write={(value) => session.setTransform(entity, { sx: value })} />
						<NumberField label="Scale Y" revision={revision} read={() => session.getTransform(entity)?.sy ?? 1} write={(value) => session.setTransform(entity, { sy: value })} />
						<h2>Sprite</h2>
						<SpriteField session={session} entity={entity} revision={revision} label="Image" />
						{() => {
							presence()
							return (
								<div>
									{definitionsOf(session)
										.filter((definition) => session.world.has(entity, definition))
										.map((definition) => (
											<ComponentSection session={session} entity={entity} definition={definition} revision={revision} />
										))}
									<AddComponent session={session} entity={entity} revision={revision} />
								</div>
							)
						}}
					</div>
				)
			}}
		</div>
	)
}
