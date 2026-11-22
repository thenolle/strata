/**
 * A text change: replace [from, to) with `insert`, then select [selectionStart, selectionEnd).
 */
export interface Edit {
	readonly from: number
	readonly to: number
	readonly insert: string
	readonly selectionStart: number
	readonly selectionEnd: number
}

export interface FindOptions {
	readonly caseSensitive: boolean
	readonly wholeWord: boolean
	readonly regex: boolean
}

export interface LspEdit {
	readonly line: number
	readonly character: number
	readonly endLine: number
	readonly endCharacter: number
	readonly newText: string
}

const PAIRS: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' }
const CLOSERS = new Set([')', ']', '}', '"', "'", '`'])
const SCAN_LIMIT = 20_000

function blockOf(text: string, start: number, end: number): { readonly from: number; readonly to: number } {
	const from = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1
	const last = end > start && text.charAt(end - 1) === '\n' ? end - 1 : end
	const newline = text.indexOf('\n', last)
	return { from, to: newline < 0 ? text.length : newline }
}

/**
 * Comments the lines touched by the selection, or uncomments them when they are all commented.
 */
export function toggleComment(text: string, start: number, end: number): Edit {
	const { from, to } = blockOf(text, start, end)
	const lines = text.slice(from, to).split('\n')
	const content = lines.filter((line) => line.trim() !== '')
	const commented = content.length > 0 && content.every((line) => line.trimStart().startsWith('//'))
	const indent = content.length === 0 ? 0 : Math.min(...content.map((line) => line.length - line.trimStart().length))
	const insert = lines
		.map((line) => (line.trim() === '' ? line : commented ? line.replace(/^(\s*)\/\/ ?/, '$1') : `${line.slice(0, indent)}// ${line.slice(indent)}`))
		.join('\n')
	return { from, to, insert, selectionStart: from, selectionEnd: from + insert.length }
}

/**
 * Indents or outdents the lines touched by the selection.
 */
export function indentLines(text: string, start: number, end: number, outdent: boolean): Edit {
	const { from, to } = blockOf(text, start, end)
	const insert = text
		.slice(from, to)
		.split('\n')
		.map((line) => (outdent ? line.replace(/^(\t| {1,2})/, '') : line === '' ? line : `\t${line}`))
		.join('\n')
	return { from, to, insert, selectionStart: from, selectionEnd: from + insert.length }
}

/**
 * Swaps the selected lines with the line above (-1) or below (1). Returns undefined at the edge of the document.
 */
export function moveLines(text: string, start: number, end: number, direction: -1 | 1): Edit | undefined {
	const { from, to } = blockOf(text, start, end)
	const block = text.slice(from, to)
	if (direction < 0) {
		if (from === 0) return undefined
		const previousStart = from - 1 === 0 ? 0 : text.lastIndexOf('\n', from - 2) + 1
		const previous = text.slice(previousStart, from - 1)
		const shift = previous.length + 1
		return { from: previousStart, to, insert: `${block}\n${previous}`, selectionStart: start - shift, selectionEnd: end - shift }
	}
	if (to >= text.length) return undefined
	const newline = text.indexOf('\n', to + 1)
	const nextEnd = newline < 0 ? text.length : newline
	const next = text.slice(to + 1, nextEnd)
	const shift = next.length + 1
	return { from, to: nextEnd, insert: `${next}\n${block}`, selectionStart: start + shift, selectionEnd: end + shift }
}

/**
 * Copies the selected lines. With direction 1 the selection moves to the lower copy, with -1 it stays on the upper one.
 */
export function duplicateLines(text: string, start: number, end: number, direction: -1 | 1): Edit {
	const { from, to } = blockOf(text, start, end)
	const block = text.slice(from, to)
	const shift = direction > 0 ? block.length + 1 : 0
	return { from, to, insert: `${block}\n${block}`, selectionStart: start + shift, selectionEnd: end + shift }
}

/**
 * Decides what typing one character should do: close a bracket or quote, type over a closing one, or wrap a selection.
 * Returns undefined when the character should be typed normally.
 */
export function autoClose(text: string, start: number, end: number, typed: string): Edit | undefined {
	const closer = PAIRS[typed]
	if (start !== end) {
		if (closer === undefined) return undefined
		return { from: start, to: end, insert: `${typed}${text.slice(start, end)}${closer}`, selectionStart: start + 1, selectionEnd: end + 1 }
	}
	const next = text.charAt(start)
	if (CLOSERS.has(typed) && next === typed) return { from: start, to: start + 1, insert: typed, selectionStart: start + 1, selectionEnd: start + 1 }
	if (closer === undefined) return undefined
	const quote = typed === '"' || typed === "'" || typed === '`'
	if (quote && /[\w$]/.test(text.charAt(start - 1))) return undefined
	if (!/^[\s)\]}.,;]?$/.test(next)) return undefined
	return { from: start, to: start, insert: `${typed}${closer}`, selectionStart: start + 1, selectionEnd: start + 1 }
}

function scan(text: string, from: number, step: 1 | -1, same: string, other: string): number | undefined {
	let depth = 0
	for (let index = from, count = 0; index >= 0 && index < text.length && count < SCAN_LIMIT; index += step, count++) {
		const char = text.charAt(index)
		if (char === same) depth++
		else if (char === other && --depth === 0) return index
	}
	return undefined
}

/**
 * Finds the bracket that pairs with the one next to the caret.
 */
export function findBracketMatch(text: string, caret: number): { readonly open: number; readonly close: number } | undefined {
	for (const index of [caret - 1, caret]) {
		if (index < 0 || index >= text.length) continue
		const char = text.charAt(index)
		const open = '([{'.indexOf(char)
		if (open >= 0) {
			const close = scan(text, index, 1, char, ')]}'.charAt(open))
			if (close !== undefined) return { open: index, close }
		}
		const close = ')]}'.indexOf(char)
		if (close >= 0) {
			const found = scan(text, index, -1, char, '([{'.charAt(close))
			if (found !== undefined) return { open: found, close: index }
		}
	}
	return undefined
}

/**
 * Every match of a search, as character ranges. An invalid regular expression has no matches.
 */
export function findAll(text: string, query: string, options: FindOptions): { readonly from: number; readonly to: number }[] {
	if (query === '') return []
	let source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	if (options.wholeWord) source = `\\b(?:${source})\\b`
	let pattern: RegExp
	try {
		pattern = new RegExp(source, options.caseSensitive ? 'g' : 'gi')
	} catch {
		return []
	}
	const matches: { from: number; to: number }[] = []
	for (const match of text.matchAll(pattern)) {
		const from = match.index ?? 0
		if (match[0].length === 0) continue
		matches.push({ from, to: from + match[0].length })
		if (matches.length >= 5000) break
	}
	return matches
}

/**
 * Applies language server text edits, given as line and character positions, to a text.
 */
export function applyTextEdits(text: string, edits: readonly LspEdit[]): string {
	const starts = [0]
	for (let index = 0; index < text.length; index++) if (text.charAt(index) === '\n') starts.push(index + 1)
	const offset = (line: number, character: number): number => (line >= starts.length ? text.length : Math.min(text.length, (starts[line] ?? 0) + character))
	const resolved = edits.map((edit) => ({ from: offset(edit.line, edit.character), to: offset(edit.endLine, edit.endCharacter), newText: edit.newText })).sort((a, b) => b.from - a.from)
	let result = text
	for (const edit of resolved) result = result.slice(0, edit.from) + edit.newText + result.slice(edit.to)
	return result
}
