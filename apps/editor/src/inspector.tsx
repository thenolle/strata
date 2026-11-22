/** @jsxImportSource @gambrel/view */
import { effect, onCleanup } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import type { Entity } from '@strata/core'
import type { EditorSession } from '@strata/editor-core'

interface FieldProps {
	readonly label: string
	readonly revision: () => number
}

function format(value: number): string {
	return String(Number(value.toFixed(4)))
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

/**
 * Edits the selected entity. Inputs are created once per selection and refreshed through effects,
 * so typing never loses focus while the viewport changes values.
 */
export function Inspector(props: {
	readonly session: EditorSession
	readonly selected: () => Entity | undefined
	readonly revision: () => number
}): Child {
	return (
		<div class="inspector-body">
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
					</div>
				)
			}}
		</div>
	)
}
