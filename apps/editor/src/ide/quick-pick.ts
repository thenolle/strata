import { fuzzyScore } from './fuzzy.ts'

export interface PickItem<T> {
	readonly label: string
	readonly detail: string
	readonly value: T
}

/**
 * A filterable list over the editor. Up and Down move, Enter picks, Escape closes. Returns a function that closes it.
 */
export function quickPick<T>(
	host: HTMLElement,
	options: { readonly placeholder: string; readonly items: readonly PickItem<T>[]; readonly onPick: (value: T) => void; readonly onClose: () => void }
): () => void {
	const wrapper = document.createElement('div')
	wrapper.className = 'ide-pick'
	const input = document.createElement('input')
	input.type = 'text'
	input.placeholder = options.placeholder
	input.spellcheck = false
	const list = document.createElement('ul')
	wrapper.append(input, list)
	host.append(wrapper)
	let shown: readonly PickItem<T>[] = []
	let selected = 0
	let closed = false
	const close = (): void => {
		if (closed) return
		closed = true
		wrapper.remove()
		options.onClose()
	}
	const choose = (item: PickItem<T> | undefined): void => {
		if (item === undefined) return
		close()
		options.onPick(item.value)
	}
	const paint = (): void => {
		list.replaceChildren(
			...shown.map((item, index) => {
				const row = document.createElement('li')
				row.dataset['active'] = String(index === selected)
				const label = document.createElement('span')
				label.textContent = item.label
				const detail = document.createElement('span')
				detail.className = 'ide-detail'
				detail.textContent = item.detail
				row.append(label, detail)
				row.addEventListener('mousedown', (event) => {
					event.preventDefault()
					choose(item)
				})
				return row
			})
		)
		if (shown.length === 0) {
			const empty = document.createElement('li')
			empty.textContent = 'No matches'
			list.append(empty)
		}
		list.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
	}
	const filter = (): void => {
		const query = input.value.trim()
		shown = options.items
			.flatMap((item) => {
				const score = fuzzyScore(query, item.label)
				return score === undefined ? [] : [{ item, score }]
			})
			.sort((a, b) => b.score - a.score)
			.slice(0, 50)
			.map((entry) => entry.item)
		selected = 0
		paint()
	}
	input.addEventListener('input', filter)
	input.addEventListener('keydown', (event) => {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault()
			if (shown.length > 0) selected = (selected + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length
			paint()
		} else if (event.key === 'Enter') {
			event.preventDefault()
			choose(shown[selected])
		} else if (event.key === 'Escape') {
			event.preventDefault()
			event.stopPropagation()
			close()
		}
	})
	input.addEventListener('blur', close)
	filter()
	input.focus()
	return close
}
