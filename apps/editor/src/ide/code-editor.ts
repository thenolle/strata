import { renderLines } from './highlight.ts'
import type { Completion, Diagnostic, IdeClient } from './ide-client.ts'
import { renderMarkdown } from './markdown.ts'

const LINE_HEIGHT = 20
const PADDING = 12
const TAB = 2
const CHANGE_DELAY_MS = 120
const COMPLETE_DELAY_MS = 60
const POLL_MS = 500
const HOVER_DELAY_MS = 350
const MAX_ITEMS = 10
const BADGES: Readonly<Record<number, string>> = { 2: 'm', 3: 'f', 4: 'c', 5: 'p', 6: 'v', 7: 'C', 8: 'I', 9: 'M', 10: 'p', 14: 'k', 21: 'c', 22: 'S', 25: 'T' }

export interface CodeEditorOptions {
	/** Document name, unique among open documents, letters, digits, hyphens and underscores. */
	readonly name: string
	readonly text: string
	readonly client: IdeClient
	readonly onChange: (text: string) => void
	readonly onSave: () => void
	readonly onClose: () => void
	readonly onDiagnostics: (diagnostics: readonly Diagnostic[]) => void
	readonly onCursor: (line: number, column: number) => void
}

function visualColumn(line: string, column: number): number {
	let visual = 0
	for (let index = 0; index < column && index < line.length; index++) visual += line[index] === '\t' ? TAB - (visual % TAB) : 1
	return visual
}

function indexAtVisual(line: string, visual: number): number {
	let column = 0
	for (let index = 0; index < line.length; index++) {
		const width = line[index] === '\t' ? TAB - (column % TAB) : 1
		if (column + width > visual) return index
		column += width
	}
	return line.length
}

function covers(item: Diagnostic, line: number, character: number): boolean {
	const afterStart = line > item.line || (line === item.line && character >= item.character)
	const beforeEnd = line < item.endLine || (line === item.endLine && character < item.endCharacter)
	return afterStart && beforeEnd
}

/**
 * A code editor built from scratch: a transparent textarea over a syntax-highlighted layer, so typing, selection,
 * clipboard and undo are native. Language features come from the editor server's TypeScript language server.
 */
export class CodeEditor {
	readonly element: HTMLDivElement
	readonly #input = document.createElement('textarea')
	readonly #highlight = document.createElement('pre')
	readonly #gutter = document.createElement('pre')
	readonly #body = document.createElement('div')
	readonly #popup = document.createElement('ul')
	readonly #tooltip = document.createElement('div')
	readonly #options: CodeEditorOptions
	#diagnostics: readonly Diagnostic[] = []
	#diagnosticsKey = '[]'
	#charWidth = 8
	#items: readonly Completion[] = []
	#selected = 0
	#requestId = 0
	#sentText: string | undefined
	#lineCount = 0
	#suppress = false
	#disposed = false
	#refreshing = false
	#changeTimer: ReturnType<typeof setTimeout> | undefined
	#completeTimer: ReturnType<typeof setTimeout> | undefined
	#hoverTimer: ReturnType<typeof setTimeout> | undefined
	#poll: ReturnType<typeof setInterval> | undefined

	constructor(options: CodeEditorOptions) {
		this.#options = options
		this.element = document.createElement('div')
		this.element.className = 'ide'
		this.#gutter.className = 'ide-gutter'
		this.#body.className = 'ide-body'
		this.#highlight.className = 'ide-highlight'
		this.#highlight.setAttribute('aria-hidden', 'true')
		this.#input.className = 'ide-input'
		this.#input.spellcheck = false
		this.#input.wrap = 'off'
		this.#input.setAttribute('autocomplete', 'off')
		this.#input.setAttribute('autocapitalize', 'off')
		this.#input.setAttribute('aria-label', 'Script code')
		this.#input.value = options.text
		this.#popup.className = 'ide-popup'
		this.#popup.setAttribute('role', 'listbox')
		this.#popup.hidden = true
		this.#tooltip.className = 'ide-tooltip'
		this.#tooltip.hidden = true
		this.#body.append(this.#highlight, this.#input, this.#popup, this.#tooltip)
		this.element.append(this.#gutter, this.#body)
		this.#input.addEventListener('input', this.#onInput)
		this.#input.addEventListener('keydown', this.#onKeyDown)
		this.#input.addEventListener('keyup', this.#reportCursor)
		this.#input.addEventListener('mouseup', this.#reportCursor)
		this.#input.addEventListener('focus', this.#reportCursor)
		this.#input.addEventListener('scroll', this.#onScroll)
		this.#input.addEventListener('blur', this.#onBlur)
		this.#body.addEventListener('mousemove', this.#onMouseMove)
		this.#body.addEventListener('mouseleave', this.#hideTooltip)
		this.#render()
		requestAnimationFrame(() => this.#measure())
		void this.#send()
		this.#poll = setInterval(() => void this.#refreshDiagnostics(), POLL_MS)
	}

	get value(): string {
		return this.#input.value
	}

	focus(): void {
		this.#input.focus()
	}

	/** Inserts text at the caret, replacing the selection. Keeps native undo working. */
	insertText(text: string): void {
		this.#insert(text)
	}

	/** Moves the caret to a line and character, both counted from zero, and scrolls it into view. */
	reveal(line: number, character: number): void {
		const lines = this.#input.value.split('\n')
		let offset = character
		for (let index = 0; index < line && index < lines.length; index++) offset += (lines[index] ?? '').length + 1
		this.#input.focus()
		this.#input.setSelectionRange(offset, offset)
		this.#input.scrollTop = Math.max(0, line * LINE_HEIGHT - 80)
	}

	dispose(): void {
		if (this.#disposed) return
		this.#disposed = true
		clearTimeout(this.#changeTimer)
		clearTimeout(this.#completeTimer)
		clearTimeout(this.#hoverTimer)
		clearInterval(this.#poll)
		void this.#options.client.close(this.#options.name).catch(() => undefined)
		this.element.remove()
	}

	#measure(): void {
		const probe = document.createElement('span')
		probe.className = 'ide-probe'
		probe.textContent = 'x'.repeat(100)
		this.#body.append(probe)
		const width = probe.getBoundingClientRect().width / 100
		probe.remove()
		if (width > 0) this.#charWidth = width
	}

	#render(): void {
		const text = this.#input.value
		this.#highlight.innerHTML = `${renderLines(text, this.#diagnostics)}\n`
		const count = text.split('\n').length
		if (count !== this.#lineCount) {
			this.#lineCount = count
			this.#gutter.textContent = Array.from({ length: count }, (_, index) => String(index + 1)).join('\n')
		}
	}

	#position(): { readonly line: number; readonly character: number; readonly lineText: string; readonly lineStart: number; readonly wordStart: number } {
		const value = this.#input.value
		const caret = this.#input.selectionStart
		const lineStart = caret === 0 ? 0 : value.lastIndexOf('\n', caret - 1) + 1
		const lineEnd = value.indexOf('\n', caret)
		const lineText = value.slice(lineStart, lineEnd < 0 ? undefined : lineEnd)
		const character = caret - lineStart
		let wordStart = character
		while (wordStart > 0 && /[\w$]/.test(lineText.charAt(wordStart - 1))) wordStart--
		return { line: value.slice(0, lineStart).split('\n').length - 1, character, lineText, lineStart, wordStart }
	}

	#insert(text: string): void {
		this.#input.focus()
		if (document.execCommand('insertText', false, text)) return
		this.#input.setRangeText(text, this.#input.selectionStart, this.#input.selectionEnd, 'end')
		this.#onInput()
	}

	#insertNewline(): void {
		const at = this.#position()
		const indent = /^[\t ]*/.exec(at.lineText)?.[0] ?? ''
		const before = at.lineText.slice(0, at.character).trimEnd().slice(-1)
		const after = at.lineText.charAt(at.character)
		const extra = before === '{' || before === '(' || before === '[' ? '\t' : ''
		const closes = extra !== '' && (after === '}' || after === ')' || after === ']')
		this.#insert(closes ? `\n${indent}${extra}\n${indent}` : `\n${indent}${extra}`)
		if (closes) {
			const caret = this.#input.selectionStart - indent.length - 1
			this.#input.setSelectionRange(caret, caret)
		}
	}

	async #send(): Promise<void> {
		clearTimeout(this.#changeTimer)
		const text = this.#input.value
		if (text === this.#sentText) return
		this.#sentText = text
		await this.#options.client.sync(this.#options.name, text).catch(() => undefined)
	}

	async #refreshDiagnostics(): Promise<void> {
		if (this.#disposed || this.#refreshing) return
		this.#refreshing = true
		try {
			const list = await this.#options.client.diagnostics(this.#options.name).catch(() => this.#diagnostics)
			const key = JSON.stringify(list)
			if (key === this.#diagnosticsKey || this.#disposed) return
			this.#diagnosticsKey = key
			this.#diagnostics = list
			this.#render()
			this.#options.onDiagnostics(list)
		} finally {
			this.#refreshing = false
		}
	}

	async #complete(manual: boolean): Promise<void> {
		const at = this.#position()
		const prefix = at.lineText.slice(at.wordStart, at.character)
		const afterDot = at.lineText.charAt(at.character - 1) === '.'
		if (!manual && prefix === '' && !afterDot) {
			this.#hidePopup()
			return
		}
		const id = ++this.#requestId
		await this.#send()
		const items = await this.#options.client.completion(this.#options.name, at.line, at.character).catch((): readonly Completion[] => [])
		if (id !== this.#requestId || this.#disposed) return
		const lower = prefix.toLowerCase()
		const starts = (item: Completion): number => (item.label.toLowerCase().startsWith(lower) ? 1 : 0)
		this.#items = items
			.filter((item) => item.label.toLowerCase().includes(lower))
			.sort((a, b) => starts(b) - starts(a) || a.sort.localeCompare(b.sort))
			.slice(0, MAX_ITEMS)
		this.#selected = 0
		if (this.#items.length === 0) {
			this.#hidePopup()
			return
		}
		const x = PADDING + visualColumn(at.lineText, at.wordStart) * this.#charWidth - this.#input.scrollLeft
		this.#popup.style.left = `${Math.max(0, x)}px`
		this.#popup.style.top = `${PADDING + (at.line + 1) * LINE_HEIGHT - this.#input.scrollTop}px`
		this.#popup.hidden = false
		this.#renderPopup()
	}

	#renderPopup(): void {
		this.#popup.replaceChildren(
			...this.#items.map((item, index) => {
				const row = document.createElement('li')
				row.dataset['active'] = String(index === this.#selected)
				const badge = document.createElement('span')
				badge.className = 'ide-badge'
				badge.textContent = BADGES[item.kind] ?? '·'
				const label = document.createElement('span')
				label.textContent = item.label
				const detail = document.createElement('span')
				detail.className = 'ide-detail'
				detail.textContent = item.detail
				row.append(badge, label, detail)
				row.addEventListener('mousedown', (event) => {
					event.preventDefault()
					this.#accept(item)
				})
				return row
			})
		)
		this.#popup.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
	}

	#hidePopup(): void {
		this.#popup.hidden = true
		this.#requestId++
	}

	#accept(item: Completion): void {
		const at = this.#position()
		const from = item.from ?? at.wordStart
		this.#suppress = true
		this.#input.setSelectionRange(at.lineStart + from, this.#input.selectionStart)
		this.#insert(item.insert)
		this.#suppress = false
		this.#hidePopup()
	}

	async #hover(clientX: number, clientY: number): Promise<void> {
		const rect = this.#input.getBoundingClientRect()
		const x = clientX - rect.left + this.#input.scrollLeft - PADDING
		const y = clientY - rect.top + this.#input.scrollTop - PADDING
		if (x < 0 || y < 0) return
		const line = Math.floor(y / LINE_HEIGHT)
		const text = this.#input.value.split('\n')[line]
		if (text === undefined) return
		const character = indexAtVisual(text, Math.floor(x / this.#charWidth))
		if (character >= text.length) return
		const problem = this.#diagnostics.find((item) => covers(item, line, character))
		await this.#send()
		const documentation = await this.#options.client.hover(this.#options.name, line, character).catch(() => '')
		if (this.#disposed || (documentation === '' && problem === undefined)) return
		this.#tooltip.replaceChildren()
		if (problem !== undefined) {
			const error = document.createElement('div')
			error.className = 'ide-tooltip-error'
			error.textContent = problem.message
			this.#tooltip.append(error)
		}
		if (documentation !== '') this.#tooltip.append(renderMarkdown(documentation))
		const body = this.#body.getBoundingClientRect()
		this.#tooltip.hidden = false
		const tip = this.#tooltip.getBoundingClientRect()
		let left = clientX - body.left + 12
		let top = clientY - body.top + 18
		if (left + tip.width > body.width - 8) left = Math.max(0, body.width - tip.width - 8)
		if (top + tip.height > body.height - 8) top = Math.max(0, clientY - body.top - tip.height - 8)
		this.#tooltip.style.left = `${left}px`
		this.#tooltip.style.top = `${top}px`
	}

	readonly #hideTooltip = (): void => {
		clearTimeout(this.#hoverTimer)
		this.#tooltip.hidden = true
	}

	readonly #reportCursor = (): void => {
		const at = this.#position()
		this.#options.onCursor(at.line + 1, at.character + 1)
	}

	readonly #onInput = (): void => {
		this.#render()
		this.#hideTooltip()
		this.#options.onChange(this.#input.value)
		clearTimeout(this.#changeTimer)
		this.#changeTimer = setTimeout(() => void this.#send(), CHANGE_DELAY_MS)
		if (!this.#suppress) {
			clearTimeout(this.#completeTimer)
			this.#completeTimer = setTimeout(() => void this.#complete(false), COMPLETE_DELAY_MS)
		}
		this.#reportCursor()
	}

	readonly #onScroll = (): void => {
		this.#highlight.scrollTop = this.#input.scrollTop
		this.#highlight.scrollLeft = this.#input.scrollLeft
		this.#gutter.scrollTop = this.#input.scrollTop
		this.#hideTooltip()
		if (!this.#popup.hidden) this.#hidePopup()
	}

	readonly #onBlur = (): void => {
		setTimeout(() => {
			if (!this.#disposed) this.#hidePopup()
		}, 150)
	}

	readonly #onMouseMove = (event: MouseEvent): void => {
		clearTimeout(this.#hoverTimer)
		if (event.target !== this.#input) return
		this.#hoverTimer = setTimeout(() => void this.#hover(event.clientX, event.clientY), HOVER_DELAY_MS)
	}

	readonly #onKeyDown = (event: KeyboardEvent): void => {
		if (!this.#popup.hidden) {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault()
				const count = this.#items.length
				this.#selected = (this.#selected + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
				this.#renderPopup()
				return
			}
			if (event.key === 'Enter' || event.key === 'Tab') {
				const item = this.#items[this.#selected]
				if (item !== undefined) {
					event.preventDefault()
					this.#accept(item)
					return
				}
			}
			if (event.key === 'Escape') {
				event.preventDefault()
				event.stopPropagation()
				this.#hidePopup()
				return
			}
		}
		this.#hideTooltip()
		const command = event.ctrlKey || event.metaKey
		if (command && event.key === ' ') {
			event.preventDefault()
			void this.#complete(true)
		} else if (command && event.key.toLowerCase() === 's') {
			event.preventDefault()
			event.stopPropagation()
			this.#options.onSave()
		} else if (event.key === 'Tab' && !event.shiftKey) {
			event.preventDefault()
			this.#insert('\t')
		} else if (event.key === 'Enter' && !command && !event.shiftKey) {
			event.preventDefault()
			this.#insertNewline()
		} else if (event.key === 'Escape') {
			event.stopPropagation()
			this.#options.onClose()
		}
	}
}
