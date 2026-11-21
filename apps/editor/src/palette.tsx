/** @jsxImportSource @gambrel/view */
import { onCleanup, signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import { QuickPickModel, type CommandRegistry, type KeybindingService } from '@strata/commands'

function highlight(label: string, positions: readonly number[]): Child {
	if (positions.length === 0) return label
	const marked = new Set(positions)
	const parts: Child[] = []
	let run = ''
	let runMarked = false
	const flush = (): void => {
		if (run === '') return
		parts.push(runMarked ? <mark>{run}</mark> : run)
		run = ''
	}
	for (let index = 0; index < label.length; index++) {
		const isMarked = marked.has(index)
		if (isMarked !== runMarked) {
			flush()
			runMarked = isMarked
		}
		run += label.charAt(index)
	}
	flush()
	return parts
}

/**
 * Searchable list of every available command with its shortcut. Arrow keys move, Enter runs, Escape closes.
 */
export function CommandPalette(props: {
	readonly registry: CommandRegistry
	readonly keybindings: KeybindingService
	readonly onRun: (commandId: string) => void
	readonly onClose: () => void
}): Child {
	const items = props.registry.list({ enabledOnly: true }).map((command) => {
		const shortcut = props.keybindings.labelFor(command.id)
		return {
			label: command.category === undefined ? command.title : `${command.category}: ${command.title}`,
			...(shortcut === undefined ? {} : { description: shortcut }),
			value: command.id
		}
	})
	const model = new QuickPickModel(items)
	const results = signal(model.results)
	const active = signal(model.index)
	const sync = (): void => {
		results.set(model.results)
		active.set(model.index)
	}
	const scrollActive = (): void => {
		queueMicrotask(() => document.querySelector('.palette-row[data-active="true"]')?.scrollIntoView({ block: 'nearest' }))
	}

	return (
		<div
			class="palette-backdrop"
			onClick={(event) => {
				if (event.target === event.currentTarget) props.onClose()
			}}
		>
			<div class="palette" role="dialog" aria-label="Command palette">
				<input
					class="palette-input"
					type="text"
					placeholder="Type a command"
					autocomplete="off"
					spellcheck="false"
					ref={(element: Element) => {
						const input = element as HTMLInputElement
						const onInput = (): void => {
							model.setQuery(input.value)
							sync()
						}
						const onKeyDown = (event: KeyboardEvent): void => {
							if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
								event.preventDefault()
								event.stopPropagation()
								model.move(event.key === 'ArrowDown' ? 1 : -1)
								sync()
								scrollActive()
							} else if (event.key === 'Enter') {
								event.preventDefault()
								event.stopPropagation()
								const selected = model.selected()
								if (selected === undefined) props.onClose()
								else props.onRun(selected.value)
							} else if (event.key === 'Escape') {
								event.preventDefault()
								event.stopPropagation()
								props.onClose()
							}
						}
						input.addEventListener('input', onInput)
						input.addEventListener('keydown', onKeyDown)
						requestAnimationFrame(() => input.focus())
						onCleanup(() => {
							input.removeEventListener('input', onInput)
							input.removeEventListener('keydown', onKeyDown)
						})
					}}
				/>
				{() => {
					const rows = results()
					const current = active()
					if (rows.length === 0) return <p class="palette-empty">No matching commands</p>
					return (
						<ul class="palette-list" role="listbox">
							{rows.map((row, position) => (
								<li class="palette-row" role="option" data-active={String(position === current)} onClick={() => props.onRun(row.item.value)}>
									<span class="palette-label">{highlight(row.item.label, row.labelPositions)}</span>
									{row.item.description === undefined ? null : <kbd>{row.item.description}</kbd>}
								</li>
							))}
						</ul>
					)
				}}
			</div>
		</div>
	)
}
