import type { FindOptions } from './editing.ts'

export interface FindState {
	readonly query: string
	readonly replacement: string
	readonly options: FindOptions
}

export interface FindCallbacks {
	readonly onChange: () => void
	readonly onStep: (direction: 1 | -1) => void
	readonly onReplace: () => void
	readonly onReplaceAll: () => void
	readonly onClose: () => void
}

function control(label: string, title: string, onClick: () => void): HTMLButtonElement {
	const button = document.createElement('button')
	button.type = 'button'
	button.textContent = label
	button.title = title
	button.addEventListener('click', onClick)
	return button
}

function field(placeholder: string): HTMLInputElement {
	const input = document.createElement('input')
	input.type = 'text'
	input.placeholder = placeholder
	input.spellcheck = false
	return input
}

/**
 * The find and replace bar at the top right of the editor.
 */
export class FindWidget {
	readonly element = document.createElement('div')
	readonly #find = field('Find')
	readonly #replace = field('Replace')
	readonly #count = document.createElement('span')
	readonly #replaceRow = document.createElement('div')
	readonly #toggles = { caseSensitive: false, wholeWord: false, regex: false }
	#open = false

	constructor(callbacks: FindCallbacks) {
		this.element.className = 'ide-find'
		this.element.hidden = true
		this.#count.className = 'ide-find-count'
		const toggle = (label: string, title: string, key: keyof FindOptions): HTMLButtonElement => {
			const button = control(label, title, () => {
				this.#toggles[key] = !this.#toggles[key]
				button.dataset['active'] = String(this.#toggles[key])
				callbacks.onChange()
			})
			button.dataset['active'] = 'false'
			return button
		}
		const row = document.createElement('div')
		row.className = 'ide-find-row'
		row.append(
			this.#find,
			toggle('Aa', 'Match case', 'caseSensitive'),
			toggle('ab', 'Whole word', 'wholeWord'),
			toggle('.*', 'Regular expression', 'regex'),
			this.#count,
			control('↑', 'Previous match (Shift+Enter)', () => callbacks.onStep(-1)),
			control('↓', 'Next match (Enter)', () => callbacks.onStep(1)),
			control('×', 'Close (Escape)', callbacks.onClose)
		)
		this.#replaceRow.className = 'ide-find-row'
		this.#replaceRow.append(this.#replace, control('Replace', 'Replace this match', callbacks.onReplace), control('All', 'Replace all matches', callbacks.onReplaceAll))
		this.element.append(row, this.#replaceRow)
		this.#find.addEventListener('input', callbacks.onChange)
		this.#find.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault()
				callbacks.onStep(event.shiftKey ? -1 : 1)
			} else if (event.key === 'Escape') {
				event.preventDefault()
				event.stopPropagation()
				callbacks.onClose()
			}
		})
		this.#replace.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault()
				if (event.ctrlKey || event.metaKey) callbacks.onReplaceAll()
				else callbacks.onReplace()
			} else if (event.key === 'Escape') {
				event.preventDefault()
				event.stopPropagation()
				callbacks.onClose()
			}
		})
	}

	get isOpen(): boolean {
		return this.#open
	}

	get state(): FindState {
		return { query: this.#find.value, replacement: this.#replace.value, options: { ...this.#toggles } }
	}

	open(initial: string, withReplace: boolean): void {
		this.#open = true
		this.element.hidden = false
		this.#replaceRow.hidden = !withReplace
		if (initial !== '') this.#find.value = initial
		this.#find.focus()
		this.#find.select()
	}

	close(): void {
		this.#open = false
		this.element.hidden = true
	}

	setCount(current: number, total: number): void {
		this.#count.textContent = total === 0 ? (this.#find.value === '' ? '' : 'No results') : `${current + 1} of ${total}`
	}
}

/**
 * A one-line input over the editor, used for Go to line and Rename. Enter submits, Escape cancels.
 * Returns a function that closes it.
 */
export function quickInput(host: HTMLElement, options: { readonly placeholder: string; readonly value?: string; readonly onSubmit: (value: string) => void; readonly onClose: () => void }): () => void {
	const wrapper = document.createElement('div')
	wrapper.className = 'ide-quick'
	const input = field(options.placeholder)
	input.value = options.value ?? ''
	wrapper.append(input)
	host.append(wrapper)
	let closed = false
	const close = (): void => {
		if (closed) return
		closed = true
		wrapper.remove()
		options.onClose()
	}
	input.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			event.preventDefault()
			const value = input.value
			close()
			options.onSubmit(value)
		} else if (event.key === 'Escape') {
			event.preventDefault()
			event.stopPropagation()
			close()
		}
	})
	input.addEventListener('blur', close)
	input.focus()
	input.select()
	return close
}
