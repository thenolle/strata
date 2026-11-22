import { renderGutter, renderLines } from './highlight.ts'
import { renderMarkdown } from './markdown.ts'
import { FindWidget, quickInput } from './find-widget.ts'
import { applyTextEdits, autoClose, duplicateLines, findAll, findBracketMatch, indentLines, moveLines, offsetAt, toggleComment, type Edit } from './editing.ts'
import { fuzzyScore } from './fuzzy.ts'
import { expandSnippet, SNIPPETS } from './snippets.ts'
import { quickPick, type PickItem } from './quick-pick.ts'
import type { CodeAction, Completion, Definition, Diagnostic, FileEdits, HoverInfo, IdeClient, Place, RenameResult, Resolved, Signature, TextEdit } from './ide-client.ts'

const LINE_HEIGHT = 20
const PADDING = 12
const TAB = 2
const CHANGE_DELAY_MS = 120
const COMPLETE_DELAY_MS = 60
const POLL_MS = 500
const HOVER_DELAY_MS = 350
const BADGES: Readonly<Record<number, string>> = { 2: 'm', 3: 'f', 4: 'c', 5: 'p', 6: 'v', 7: 'C', 8: 'I', 9: 'M', 10: 'p', 14: 'k', 15: 's', 21: 'c', 22: 'S', 25: 'T' }
const SYMBOL_KINDS: Readonly<Record<number, string>> = { 2: 'module', 5: 'class', 6: 'method', 7: 'property', 8: 'field', 9: 'constructor', 10: 'enum', 11: 'interface', 12: 'function', 13: 'variable', 14: 'constant', 23: 'struct', 26: 'type parameter' }

export interface CodeEditorOptions {
	/** Document name, unique among open documents, letters, digits, hyphens and underscores. */
	readonly name: string
	readonly text: string
	readonly client: IdeClient
	readonly onChange: (text: string) => void
	readonly onSave: () => void
	readonly onRun: () => void
	readonly onClose: () => void
	readonly onDiagnostics: (diagnostics: readonly Diagnostic[]) => void
	readonly onCursor: (line: number, column: number) => void
	readonly onStatus: (text: string) => void
	readonly path: () => string
	readonly onNavigate: (path: string, line: number, character: number) => void
	readonly onOtherEdits: (files: readonly FileEdits[]) => void
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
	readonly #signatureTip = document.createElement('div')
	readonly #find = new FindWidget({
		onChange: () => this.#runFind(true),
		onStep: (direction) => this.#step(direction),
		onReplace: () => this.#replaceCurrent(),
		onReplaceAll: () => this.#replaceAll(),
		onClose: () => this.#closeFind()
	})
	readonly #docs = document.createElement('div')
	readonly #lineMark = document.createElement('div')
	readonly #resolved = new WeakMap<object, Resolved>()
	#wordMarks: Diagnostic[] = []
	#wordTimer: ReturnType<typeof setTimeout> | undefined
	#docsTimer: ReturnType<typeof setTimeout> | undefined
	#pick: (() => void) | undefined
	#snippet: { length: number; current: number; stops: { start: number; end: number }[] } | undefined
	#renderedText = ''
	#renderedMarks = ''
	#renderedDiagnostics = ''
	#gutterKey = ''
	#measured = false
	#hoverMark: Diagnostic | undefined
	#matches: { readonly from: number; readonly to: number }[] = []
	#current = -1
	#marks: Diagnostic[] = []
	#quick: (() => void) | undefined
	#signatureOpen = false
	#signatureTimer: ReturnType<typeof setTimeout> | undefined
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
	#diagnosticsStale = true

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
		this.element.append(this.#gutter, this.#body)
		this.#signatureTip.className = 'ide-tooltip ide-signature'
		this.#signatureTip.hidden = true
		this.#lineMark.className = 'ide-line'
		this.#docs.className = 'ide-tooltip ide-docs'
		this.#docs.hidden = true
		this.#body.append(this.#lineMark, this.#highlight, this.#input, this.#popup, this.#docs, this.#tooltip, this.#signatureTip, this.#find.element)
		this.#input.addEventListener('input', this.#onInput)
		this.#input.addEventListener('keydown', this.#onKeyDown)
		this.#input.addEventListener('keyup', this.#reportCursor)
		this.#input.addEventListener('mouseup', this.#reportCursor)
		this.#input.addEventListener('focus', this.#reportCursor)
		this.#input.addEventListener('scroll', this.#onScroll)
		this.#input.addEventListener('blur', this.#onBlur)
		this.#input.addEventListener('mousedown', this.#onMouseDown)
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

	/** Marks the problems list as out of date, for when another script changed. */
	invalidate(): void {
		this.#diagnosticsStale = true
	}

	dispose(): void {
		if (this.#disposed) return
		this.#disposed = true
		clearTimeout(this.#changeTimer)
		clearTimeout(this.#completeTimer)
		clearTimeout(this.#hoverTimer)
		clearTimeout(this.#signatureTimer)
		clearTimeout(this.#wordTimer)
		clearTimeout(this.#docsTimer)
		clearInterval(this.#poll)
		this.#quick?.()
		this.#pick?.()
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
		if (width > 0) {
			this.#charWidth = width
			this.#measured = true
		}
	}

	#render(): void {
		const text = this.#input.value
		const marks = [...this.#marks, ...this.#wordMarks, ...(this.#hoverMark === undefined ? [] : [this.#hoverMark])]
		const marksKey = JSON.stringify(marks)
		if (text === this.#renderedText && marksKey === this.#renderedMarks && this.#diagnosticsKey === this.#renderedDiagnostics) return
		this.#renderedText = text
		this.#renderedMarks = marksKey
		this.#renderedDiagnostics = this.#diagnosticsKey
		this.#highlight.innerHTML = `${renderLines(text, [...this.#diagnostics, ...marks])}\n`
		const count = text.split('\n').length
		const gutterKey = `${count}:${this.#diagnosticsKey}`
		if (gutterKey !== this.#gutterKey) {
			this.#gutterKey = gutterKey
			this.#lineCount = count
			this.#gutter.innerHTML = renderGutter(count, this.#diagnostics)
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
		this.#diagnosticsStale = true
		await this.#options.client.sync(this.#options.name, text, this.#options.path()).catch(() => undefined)
	}

	async #refreshDiagnostics(): Promise<void> {
		if (this.#disposed || this.#refreshing || !this.#diagnosticsStale || this.element.offsetParent === null) return
		this.#refreshing = true
		this.#diagnosticsStale = false
		try {
			const list = await this.#options.client.diagnostics(this.#options.name).catch(() => this.#diagnostics)
			const key = JSON.stringify(list)
			if (key === this.#diagnosticsKey || this.#disposed) return
			this.#diagnosticsKey = key
			this.#diagnosticsStale = true
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
		const afterDot = at.lineText.charAt(at.character - 1) === '.' || at.lineText.charAt(at.wordStart - 1) === '.'
		const inPath = /(?:from\s+|import\s+)['"][^'"]*$/.test(at.lineText.slice(0, at.character))
		if (!manual && prefix === '' && !afterDot && !inPath) {
			this.#hidePopup()
			return
		}
		const id = ++this.#requestId
		await this.#send()
		const items = await this.#options.client.completion(this.#options.name, at.line, at.character).catch((): readonly Completion[] => [])
		if (id !== this.#requestId || this.#disposed) return
		const snippets: Completion[] = afterDot || inPath || prefix === '' ? [] : SNIPPETS.map((snippet) => ({ label: snippet.label, kind: 15, detail: snippet.detail, insert: snippet.body, sort: `~${snippet.label}`, from: at.wordStart, snippet: true }))
		const scored: { readonly item: Completion; readonly score: number }[] = []
		for (const item of [...items, ...snippets]) {
			const score = fuzzyScore(prefix, item.label)
			if (score !== undefined) scored.push({ item, score })
		}
		scored.sort((a, b) => b.score - a.score || a.item.sort.localeCompare(b.item.sort))
		this.#items = scored.slice(0, 40).map((entry) => entry.item)
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
				badge.className = `ide-badge ide-badge-${BADGES[item.kind] ?? 'x'}`
				badge.textContent = BADGES[item.kind] ?? '·'
				const label = document.createElement('span')
				label.textContent = item.label
				const detail = document.createElement('span')
				detail.className = 'ide-detail'
				detail.textContent = item.detail
				row.append(badge, label, detail)
				row.addEventListener('mousedown', (event) => {
					event.preventDefault()
					void this.#accept(item)
				})
				return row
			})
		)
		this.#popup.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
		this.#scheduleDocs()
	}

	#hidePopup(): void {
		this.#popup.hidden = true
		this.#docs.hidden = true
		this.#requestId++
	}

	#scheduleDocs(): void {
		clearTimeout(this.#docsTimer)
		this.#docs.hidden = true
		const item = this.#items[this.#selected]
		if (item === undefined || typeof item.raw !== 'object' || item.raw === null) return
		this.#docsTimer = setTimeout(() => void this.#showDocs(item), 120)
	}

	async #resolve(item: Completion): Promise<Resolved | undefined> {
		const raw = item.raw
		if (typeof raw !== 'object' || raw === null) return undefined
		const known = this.#resolved.get(raw)
		if (known !== undefined) return known
		const result = await this.#options.client.resolve(this.#options.name, raw).catch((): Resolved | undefined => undefined)
		if (result !== undefined) this.#resolved.set(raw, result)
		return result
	}

	async #showDocs(item: Completion): Promise<void> {
		const result = await this.#resolve(item)
		if (result === undefined || this.#popup.hidden || this.#items[this.#selected] !== item) return
		if (result.detail === '' && result.documentation === '') return
		this.#docs.replaceChildren()
		if (result.detail !== '') {
			const code = document.createElement('div')
			code.className = 'ide-signature-label'
			code.textContent = result.detail
			this.#docs.append(code)
		}
		if (result.documentation !== '') this.#docs.append(renderMarkdown(result.documentation))
		this.#docs.style.left = `${this.#popup.offsetLeft + this.#popup.offsetWidth + 6}px`
		this.#docs.style.top = `${this.#popup.offsetTop}px`
		this.#docs.hidden = false
	}

	async #accept(item: Completion): Promise<void> {
		const at = this.#position()
		const from = at.lineStart + (item.from ?? at.wordStart)
		const to = this.#input.selectionStart
		this.#hidePopup()
		if (item.snippet === true) {
			this.#insertSnippet(from, to, item.insert)
			return
		}
		const extra = item.raw === undefined ? [] : ((await this.#resolve(item))?.edits ?? [])
		this.#suppress = true
		if (extra.length === 0) {
			this.#input.setSelectionRange(from, to)
			this.#insert(item.insert)
		} else {
			this.#applyWithExtras(from, to, item.insert, extra)
		}
		this.#suppress = false
	}

	#applyWithExtras(from: number, to: number, insert: string, extra: readonly TextEdit[]): void {
		const value = this.#input.value
		const edits = [{ from, to, newText: insert }, ...extra.map((edit) => ({ from: offsetAt(value, edit.line, edit.character), to: offsetAt(value, edit.endLine, edit.endCharacter), newText: edit.newText }))]
		const shift = edits.slice(1).filter((edit) => edit.to <= from).reduce((total, edit) => total + edit.newText.length - (edit.to - edit.from), 0)
		let text = value
		for (const edit of [...edits].sort((a, b) => b.from - a.from)) text = text.slice(0, edit.from) + edit.newText + text.slice(edit.to)
		this.#replaceWhole(text, from + insert.length + shift)
	}

	#insertSnippet(from: number, to: number, body: string): void {
		const indent = /^[\t ]*/.exec(this.#position().lineText)?.[0] ?? ''
		const expanded = expandSnippet(body, indent)
		this.#suppress = true
		this.#input.setSelectionRange(from, to)
		this.#insert(expanded.text)
		this.#suppress = false
		this.#snippet = { length: this.#input.value.length, current: -1, stops: expanded.stops.map((stop) => ({ start: from + stop.start, end: from + stop.end })) }
		this.#nextStop()
	}

	#nextStop(): void {
		const session = this.#snippet
		if (session === undefined) return
		session.current++
		const stop = session.stops[session.current]
		if (stop === undefined) {
			this.#snippet = undefined
			return
		}
		this.#input.setSelectionRange(stop.start, stop.end)
		if (session.current === session.stops.length - 1) this.#snippet = undefined
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
		const info = await this.#options.client.hover(this.#options.name, line, character).catch((): HoverInfo => ({ text: '' }))
		if (this.#disposed || (info.text === '' && problem === undefined)) return
		this.#tooltip.replaceChildren()
		if (problem !== undefined) {
			const error = document.createElement('div')
			error.className = 'ide-tooltip-error'
			error.textContent = problem.message
			this.#tooltip.append(error)
		}
		if (info.text !== '') {
			this.#tooltip.append(renderMarkdown(info.text))
			const hint = document.createElement('div')
			hint.className = 'ide-tooltip-footer'
			hint.textContent = 'F12 or Ctrl+click: go to definition'
			this.#tooltip.append(hint)
		}
		if (info.range !== undefined) {
			this.#hoverMark = { line: info.range.line, character: info.range.character, endLine: info.range.endLine, endCharacter: info.range.endCharacter, severity: -3, message: '' }
			this.#render()
		}
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
		if (this.#hoverMark !== undefined) {
			this.#hoverMark = undefined
			this.#render()
		}
	}

	readonly #reportCursor = (): void => {
		this.#updateLine()
		this.#scheduleWord()
		if (!this.#measured) this.#measure()
		const at = this.#position()
		this.#options.onCursor(at.line + 1, at.character + 1)
		this.#updateMarks()
	}

	#updateLine(): void {
		this.#lineMark.style.top = `${PADDING + this.#position().line * LINE_HEIGHT - this.#input.scrollTop}px`
	}

	#scheduleWord(): void {
		clearTimeout(this.#wordTimer)
		this.#wordTimer = setTimeout(() => void this.#highlightWord(), 250)
	}

	async #highlightWord(): Promise<void> {
		if (this.#disposed) return
		const at = this.#position()
		const near = at.lineText.charAt(at.character - 1) + at.lineText.charAt(at.character)
		if (!/[\w$]/.test(near)) {
			if (this.#wordMarks.length > 0) {
				this.#wordMarks = []
				this.#render()
			}
			return
		}
		const text = this.#input.value
		await this.#send()
		const list = await this.#options.client.highlights(this.#options.name, at.line, at.character).catch(() => [])
		if (this.#disposed || this.#input.value !== text) return
		this.#wordMarks = list.length > 1 ? list.map((range) => ({ ...range, severity: -4, message: '' })) : []
		this.#render()
	}

	readonly #onInput = (): void => {
		this.#wordMarks = []
		const session = this.#snippet
		if (session !== undefined) {
			const delta = this.#input.value.length - session.length
			const stop = session.stops[session.current]
			const caret = this.#input.selectionStart
			if (stop === undefined || caret < stop.start || caret > stop.end + delta) {
				this.#snippet = undefined
			} else {
				session.length += delta
				stop.end += delta
				for (let index = session.current + 1; index < session.stops.length; index++) {
					const later = session.stops[index]
					if (later !== undefined) {
						later.start += delta
						later.end += delta
					}
				}
			}
		}
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
		if (this.#find.isOpen) this.#runFind(false)
		if (this.#signatureOpen) {
			clearTimeout(this.#signatureTimer)
			this.#signatureTimer = setTimeout(() => void this.#signature(), 120)
		}
	}

	readonly #onScroll = (): void => {
		this.#highlight.scrollTop = this.#input.scrollTop
		this.#highlight.scrollLeft = this.#input.scrollLeft
		this.#gutter.scrollTop = this.#input.scrollTop
		this.#hideTooltip()
		if (!this.#popup.hidden) this.#hidePopup()
		this.#updateLine()
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
					void this.#accept(item)
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
		if (!this.#signatureOpen) this.#signatureTip.hidden = true
		const command = event.ctrlKey || event.metaKey
		const key = event.key
		const lower = key.toLowerCase()
		const value = this.#input.value
		const start = this.#input.selectionStart
		const end = this.#input.selectionEnd
		if (command && key === ' ') {
			event.preventDefault()
			void this.#complete(true)
		} else if (command && lower === 's') {
			event.preventDefault()
			event.stopPropagation()
			this.#options.onSave()
		} else if (command && !event.shiftKey && lower === 'f') {
			event.preventDefault()
			this.#openFind(false)
		} else if (command && lower === 'h') {
			event.preventDefault()
			this.#openFind(true)
		} else if (command && lower === 'g') {
			event.preventDefault()
			this.#gotoLine()
		} else if (command && key === '/') {
			event.preventDefault()
			this.#apply(toggleComment(value, start, end))
		} else if (event.altKey && !command && (key === 'ArrowUp' || key === 'ArrowDown')) {
			event.preventDefault()
			const direction = key === 'ArrowDown' ? 1 : -1
			const edit = event.shiftKey ? duplicateLines(value, start, end, direction) : moveLines(value, start, end, direction)
			if (edit !== undefined) this.#apply(edit)
		} else if (event.altKey && event.shiftKey && lower === 'f') {
			event.preventDefault()
			void this.#format()
		} else if (command && key === 'Enter') {
			event.preventDefault()
			this.#options.onRun()
		} else if (command && event.shiftKey && lower === 'i') {
			event.preventDefault()
			void this.#format()
		} else if (command && key === '.') {
			event.preventDefault()
			void this.#quickFix()
		} else if (command && event.shiftKey && lower === 'o') {
			event.preventDefault()
			void this.#symbols()
		} else if (event.shiftKey && key === 'F12') {
			event.preventDefault()
			void this.#references()
		} else if (key === 'Tab' && this.#snippet !== undefined && !event.shiftKey) {
			event.preventDefault()
			this.#nextStop()
		} else if (key === 'F12') {
			event.preventDefault()
			const at = this.#position()
			void this.#definition(at.line, at.character)
		} else if (key === 'F2') {
			event.preventDefault()
			event.stopPropagation()
			this.#rename()
		} else if (key === 'F3') {
			event.preventDefault()
			this.#step(event.shiftKey ? -1 : 1)
		} else if (key === 'Tab') {
			event.preventDefault()
			if (event.shiftKey || value.slice(start, end).includes('\n')) this.#apply(indentLines(value, start, end, event.shiftKey))
			else this.#insert('\t')
		} else if (key === 'Enter' && !command && !event.shiftKey) {
			event.preventDefault()
			this.#insertNewline()
		} else if (key === 'Escape') {
			event.stopPropagation()
			this.#snippet = undefined
			if (this.#find.isOpen) this.#closeFind()
			else if (this.#signatureOpen) this.#hideSignature()
			else this.#options.onClose()
		} else if (key.length === 1 && !command && !event.altKey) {
			const edit = autoClose(value, start, end, key)
			if (edit !== undefined) {
				event.preventDefault()
				this.#apply(edit)
			}
			if (key === '(' || key === ',') setTimeout(() => void this.#signature(), 30)
			if (key === ')') this.#hideSignature()
		}
	}

	#lineColumn(offset: number): { readonly line: number; readonly character: number } {
		const before = this.#input.value.slice(0, offset)
		return { line: before.split('\n').length - 1, character: offset - (before.lastIndexOf('\n') + 1) }
	}

	#apply(edit: Edit): void {
		this.#input.focus()
		this.#input.setSelectionRange(edit.from, edit.to)
		this.#insert(edit.insert)
		this.#input.setSelectionRange(edit.selectionStart, edit.selectionEnd)
		this.#updateMarks()
	}

	#replaceWhole(text: string, target?: number): void {
		const caret = target ?? this.#input.selectionStart
		const top = this.#input.scrollTop
		const left = this.#input.scrollLeft
		this.#input.focus()
		this.#input.select()
		this.#insert(text)
		const position = Math.min(caret, text.length)
		this.#input.setSelectionRange(position, position)
		this.#input.scrollTop = top
		this.#input.scrollLeft = left
	}

	#select(from: number, to: number): void {
		this.#input.setSelectionRange(from, to)
		const top = this.#lineColumn(from).line * LINE_HEIGHT
		const view = this.#input.clientHeight
		if (top < this.#input.scrollTop + 20 || top > this.#input.scrollTop + view - 60) this.#input.scrollTop = Math.max(0, top - view / 2)
	}

	#updateMarks(): void {
		const text = this.#input.value
		const marks: Diagnostic[] = []
		const mark = (from: number, to: number, severity: number): void => {
			const a = this.#lineColumn(from)
			const b = this.#lineColumn(to)
			marks.push({ line: a.line, character: a.character, endLine: b.line, endCharacter: b.character, severity, message: '' })
		}
		if (this.#find.isOpen) {
			for (const [index, match] of this.#matches.slice(0, 500).entries()) mark(match.from, match.to, index === this.#current ? -2 : -1)
		}
		if (this.#input.selectionStart === this.#input.selectionEnd) {
			const bracket = findBracketMatch(text, this.#input.selectionStart)
			if (bracket !== undefined) {
				mark(bracket.open, bracket.open + 1, 0)
				mark(bracket.close, bracket.close + 1, 0)
			}
		}
		this.#marks = marks
		this.#render()
	}

	#openFind(replace: boolean): void {
		const selection = this.#input.value.slice(this.#input.selectionStart, this.#input.selectionEnd)
		this.#find.open(selection !== '' && !selection.includes('\n') ? selection : '', replace)
		this.#runFind(true)
	}

	#closeFind(): void {
		this.#find.close()
		this.#matches = []
		this.#current = -1
		this.#updateMarks()
		this.#input.focus()
	}

	#runFind(select: boolean): void {
		const state = this.#find.state
		this.#matches = findAll(this.#input.value, state.query, state.options)
		const next = this.#matches.findIndex((match) => match.from >= this.#input.selectionStart)
		this.#current = this.#matches.length === 0 ? -1 : next < 0 ? 0 : next
		this.#find.setCount(this.#current, this.#matches.length)
		const match = this.#matches[this.#current]
		if (select && match !== undefined) this.#select(match.from, match.to)
		this.#updateMarks()
	}

	#step(direction: 1 | -1): void {
		const count = this.#matches.length
		if (count === 0) return
		this.#current = (this.#current + direction + count) % count
		const match = this.#matches[this.#current]
		if (match !== undefined) this.#select(match.from, match.to)
		this.#find.setCount(this.#current, count)
		this.#updateMarks()
	}

	#replaceCurrent(): void {
		const match = this.#matches[this.#current]
		if (match === undefined) return
		this.#input.focus()
		this.#input.setSelectionRange(match.from, match.to)
		this.#insert(this.#find.state.replacement)
		this.#runFind(true)
	}

	#replaceAll(): void {
		if (this.#matches.length === 0) return
		const value = this.#input.value
		const replacement = this.#find.state.replacement
		let result = ''
		let cursor = 0
		for (const match of this.#matches) {
			result += value.slice(cursor, match.from) + replacement
			cursor = match.to
		}
		this.#replaceWhole(result + value.slice(cursor))
		this.#runFind(false)
	}

	#gotoLine(): void {
		this.#quick?.()
		this.#quick = quickInput(this.#body, {
			placeholder: `Go to line (1 to ${this.#lineCount})`,
			onSubmit: (value) => {
				const line = Number.parseInt(value, 10)
				if (Number.isFinite(line)) this.reveal(Math.max(0, Math.min(this.#lineCount, line) - 1), 0)
			},
			onClose: () => {
				this.#quick = undefined
				this.#input.focus()
			}
		})
	}

	#rename(): void {
		const at = this.#position()
		const word = at.lineText.slice(at.wordStart, at.character) + (/^[\w$]*/.exec(at.lineText.slice(at.character))?.[0] ?? '')
		if (word === '') return
		this.#quick?.()
		this.#quick = quickInput(this.#body, {
			placeholder: 'New name',
			value: word,
			onSubmit: (value) => void this.#doRename(at.line, at.character, value.trim()),
			onClose: () => {
				this.#quick = undefined
				this.#input.focus()
			}
		})
	}

	async #doRename(line: number, character: number, newName: string): Promise<void> {
		if (!/^[A-Za-z_$][\w$]*$/.test(newName)) return
		await this.#send()
		let result: RenameResult
		try {
			result = await this.#options.client.rename(this.#options.name, line, character, newName)
		} catch (error: unknown) {
			this.#options.onStatus(error instanceof Error ? error.message : String(error))
			return
		}
		this.applyEdits(result.edits)
		if (result.others.length > 0) this.#options.onOtherEdits(result.others)
	}

	/** Formats the whole document with the TypeScript formatter and reports the outcome through onStatus. */
	formatDocument(): void {
		void this.#format()
	}

	async #format(): Promise<void> {
		await this.#send()
		try {
			const edits = await this.#options.client.format(this.#options.name)
			const formatted = edits.length === 0 ? this.#input.value : applyTextEdits(this.#input.value, edits)
			if (formatted === this.#input.value) {
				this.#options.onStatus('Nothing to format: the document is already formatted')
				return
			}
			this.#replaceWhole(formatted)
			this.#options.onStatus('Formatted')
		} catch (error: unknown) {
			this.#options.onStatus(`Formatting failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	#hideSignature(): void {
		this.#signatureOpen = false
		this.#signatureTip.hidden = true
	}

	#placeTip(tip: HTMLElement, at: { readonly line: number; readonly lineText: string; readonly character: number }): void {
		tip.hidden = false
		const x = PADDING + visualColumn(at.lineText, at.character) * this.#charWidth - this.#input.scrollLeft
		const height = tip.getBoundingClientRect().height
		tip.style.left = `${Math.max(0, x)}px`
		tip.style.top = `${Math.max(0, PADDING + at.line * LINE_HEIGHT - this.#input.scrollTop - height - 4)}px`
	}

	async #signature(): Promise<void> {
		const at = this.#position()
		await this.#send()
		const help = await this.#options.client.signature(this.#options.name, at.line, at.character).catch((): Signature | undefined => undefined)
		if (help === undefined) {
			this.#hideSignature()
			return
		}
		const label = document.createElement('div')
		label.className = 'ide-signature-label'
		const active = help.parameters[help.active] ?? ''
		const index = active === '' ? -1 : help.label.indexOf(active)
		if (index < 0) {
			label.textContent = help.label
		} else {
			const bold = document.createElement('b')
			bold.textContent = active
			label.append(help.label.slice(0, index), bold, help.label.slice(index + active.length))
		}
		this.#signatureTip.replaceChildren(label)
		if (help.documentation !== '') this.#signatureTip.append(renderMarkdown(help.documentation))
		this.#signatureOpen = true
		this.#placeTip(this.#signatureTip, at)
	}

	async #definition(line: number, character: number): Promise<void> {
		await this.#send()
		const result = await this.#options.client.definition(this.#options.name, line, character).catch((): Definition | undefined => undefined)
		if (result === undefined) return
		if (result.local !== undefined) {
			this.reveal(result.local.line, result.local.character)
			return
		}
		if (result.other !== undefined) {
			this.#options.onNavigate(result.other.path, result.other.line, result.other.character)
			return
		}
		if (result.external === undefined) return
		const title = document.createElement('div')
		title.className = 'ide-tooltip-error'
		title.textContent = `Defined in ${result.external.file}`
		const code = document.createElement('pre')
		code.textContent = result.external.text
		this.#signatureOpen = false
		this.#signatureTip.replaceChildren(title, code)
		this.#placeTip(this.#signatureTip, this.#position())
	}

	#showPick<T>(placeholder: string, items: readonly PickItem<T>[], onPick: (value: T) => void): void {
		this.#pick?.()
		this.#pick = quickPick(this.#body, {
			placeholder,
			items,
			onPick,
			onClose: () => {
				this.#pick = undefined
				this.#input.focus()
			}
		})
	}

	async #quickFix(): Promise<void> {
		await this.#send()
		const a = this.#lineColumn(this.#input.selectionStart)
		const b = this.#lineColumn(this.#input.selectionEnd)
		const near = this.#diagnostics.filter((item) => item.line <= b.line && item.endLine >= a.line && (item.line < b.line || item.character <= b.character) && (item.endLine > a.line || item.endCharacter >= a.character))
		const actions = await this.#options.client.actions(this.#options.name, { line: a.line, character: a.character, endLine: b.line, endCharacter: b.character }, near).catch((): readonly CodeAction[] => [])
		if (actions.length === 0) {
			this.#options.onStatus('No quick fixes available here')
			return
		}
		this.#showPick('Quick fix', actions.map((action) => ({ label: action.title, detail: action.preferred ? 'preferred' : '', value: action })), (action) => {
			this.applyEdits(action.edits)
			if (action.others.length > 0) this.#options.onOtherEdits(action.others)
		})
	}

	async #symbols(): Promise<void> {
		await this.#send()
		const list = await this.#options.client.symbols(this.#options.name).catch(() => [])
		if (list.length === 0) {
			this.#options.onStatus('No symbols found')
			return
		}
		this.#showPick('Go to symbol', list.map((symbol) => ({ label: symbol.name, detail: `${'  '.repeat(symbol.depth)}${SYMBOL_KINDS[symbol.kind] ?? 'symbol'} · line ${symbol.line + 1}`, value: symbol })), (symbol) => this.reveal(symbol.line, symbol.character))
	}

	async #references(): Promise<void> {
		const at = this.#position()
		await this.#send()
		const list = await this.#options.client.references(this.#options.name, at.line, at.character).catch((): readonly Place[] => [])
		if (list.length === 0) {
			this.#options.onStatus('No references found')
			return
		}
		const own = this.#options.path()
		this.#showPick(`${list.length} reference${list.length === 1 ? '' : 's'}`, list.map((place) => ({ label: `${place.path}:${place.line + 1}`, detail: place.text, value: place })), (place) => {
			if (place.path === own) this.reveal(place.line, place.character)
			else this.#options.onNavigate(place.path, place.line, place.character)
		})
	}

	/** Applies language server edits to this document as one undoable step. */
	applyEdits(edits: readonly TextEdit[]): void {
		if (edits.length > 0) this.#replaceWhole(applyTextEdits(this.#input.value, edits))
	}

	/** Replaces the whole text as one undoable step. */
	setText(text: string): void {
		this.#replaceWhole(text, 0)
	}

	/** The commands the IDE palette offers for this editor. */
	get commands(): readonly { readonly label: string; readonly keys: string; readonly run: () => void }[] {
		const at = (): { readonly line: number; readonly character: number } => this.#position()
		return [
			{ label: 'Format Document', keys: 'Ctrl+Shift+I', run: () => this.formatDocument() },
			{ label: 'Find', keys: 'Ctrl+F', run: () => this.#openFind(false) },
			{ label: 'Replace', keys: 'Ctrl+H', run: () => this.#openFind(true) },
			{ label: 'Go to Line…', keys: 'Ctrl+G', run: () => this.#gotoLine() },
			{ label: 'Go to Symbol…', keys: 'Ctrl+Shift+O', run: () => void this.#symbols() },
			{ label: 'Go to Definition', keys: 'F12', run: () => void this.#definition(at().line, at().character) },
			{ label: 'Find All References', keys: 'Shift+F12', run: () => void this.#references() },
			{ label: 'Quick Fix…', keys: 'Ctrl+.', run: () => void this.#quickFix() },
			{ label: 'Rename Symbol', keys: 'F2', run: () => this.#rename() },
			{ label: 'Toggle Line Comment', keys: 'Ctrl+/', run: () => this.#apply(toggleComment(this.#input.value, this.#input.selectionStart, this.#input.selectionEnd)) }
		]
	}

	readonly #onMouseDown = (event: MouseEvent): void => {
		if (!event.ctrlKey && !event.metaKey) return
		const rect = this.#input.getBoundingClientRect()
		const line = Math.floor((event.clientY - rect.top + this.#input.scrollTop - PADDING) / LINE_HEIGHT)
		const text = this.#input.value.split('\n')[line]
		if (text === undefined) return
		event.preventDefault()
		const character = indexAtVisual(text, Math.floor((event.clientX - rect.left + this.#input.scrollLeft - PADDING) / this.#charWidth))
		void this.#definition(line, character)
	}
}
