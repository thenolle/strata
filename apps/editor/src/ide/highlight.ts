import type { Diagnostic } from './ide-client.ts'

export type TokenKind = 'keyword' | 'string' | 'number' | 'comment' | 'type' | 'function' | 'punctuation' | 'plain'
export type LineState = 'code' | 'comment' | 'template'

export interface Token {
	readonly kind: TokenKind
	readonly text: string
}

interface LineRange {
	readonly from: number
	readonly to: number
	readonly severity: number
}

const KEYWORDS = new Set(
	'abstract as async await break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface is keyof let namespace new null of override private protected public readonly return satisfies set static super switch this throw true try type typeof undefined var void while with yield'.split(' ')
)
const PRIMITIVES = new Set(['string', 'number', 'boolean', 'any', 'unknown', 'never', 'object', 'symbol', 'bigint'])
const NUMBER = /^(?:0[xX][0-9a-fA-F_]+|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?|\.\d+)/
const IDENTIFIER = /^[A-Za-z_$][\w$]*/

/**
 * Splits one line into tokens. The state carries multi-line comments and template strings from one line to the next.
 */
export function tokenizeLine(line: string, initial: LineState): { readonly tokens: Token[]; readonly state: LineState } {
	const tokens: Token[] = []
	let state = initial
	let index = 0
	const push = (kind: TokenKind, text: string): void => {
		if (text !== '') tokens.push({ kind, text })
	}
	while (index < line.length) {
		if (state === 'comment') {
			const end = line.indexOf('*/', index)
			if (end < 0) {
				push('comment', line.slice(index))
				index = line.length
			} else {
				push('comment', line.slice(index, end + 2))
				index = end + 2
				state = 'code'
			}
			continue
		}
		if (state === 'template') {
			let end = index
			while (end < line.length && line[end] !== '`') end += line[end] === '\\' ? 2 : 1
			if (end >= line.length) {
				push('string', line.slice(index))
				index = line.length
			} else {
				push('string', line.slice(index, end + 1))
				index = end + 1
				state = 'code'
			}
			continue
		}
		const char = line.charAt(index)
		const next = line.charAt(index + 1)
		if (char === '/' && next === '/') {
			push('comment', line.slice(index))
			break
		}
		if (char === '/' && next === '*') {
			push('comment', '/*')
			index += 2
			state = 'comment'
			continue
		}
		if (char === '"' || char === "'") {
			let end = index + 1
			while (end < line.length && line[end] !== char) end += line[end] === '\\' ? 2 : 1
			const stop = Math.min(end + 1, line.length)
			push('string', line.slice(index, stop))
			index = stop
			continue
		}
		if (char === '`') {
			push('string', '`')
			index += 1
			state = 'template'
			continue
		}
		const rest = line.slice(index)
		const number = /\d|\./.test(char) ? NUMBER.exec(rest) : null
		if (number !== null) {
			push('number', number[0])
			index += number[0].length
			continue
		}
		const word = IDENTIFIER.exec(rest)
		if (word !== null) {
			const text = word[0]
			const after = /^\s*(.?)/.exec(line.slice(index + text.length))?.[1]
			const kind: TokenKind = KEYWORDS.has(text) ? 'keyword' : PRIMITIVES.has(text) || /^[A-Z]/.test(text) ? 'type' : after === '(' ? 'function' : 'plain'
			push(kind, text)
			index += text.length
			continue
		}
		push(/\s/.test(char) ? 'plain' : 'punctuation', char)
		index += 1
	}
	return { tokens, state }
}

function escapeHtml(text: string): string {
	return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function span(kind: TokenKind, text: string, extra: string): string {
	return kind === 'plain' && extra === '' ? escapeHtml(text) : `<span class="tok-${kind}${extra}">${escapeHtml(text)}</span>`
}

function markClass(severity: number): string {
	switch (severity) {
		case 1: return ' squiggle-error'
		case 0: return ' bracket-match'
		case -1: return ' find-match'
		case -2: return ' find-current'
		default: return ' squiggle-warning'
	}
}

function renderLine(tokens: readonly Token[], ranges: readonly LineRange[]): string {
	if (ranges.length === 0) return tokens.map((token) => span(token.kind, token.text, '')).join('')
	let offset = 0
	let html = ''
	for (const token of tokens) {
		const end = offset + token.text.length
		const cuts = [offset, end]
		for (const range of ranges) {
			if (range.from > offset && range.from < end) cuts.push(range.from)
			if (range.to > offset && range.to < end) cuts.push(range.to)
		}
		cuts.sort((a, b) => a - b)
		for (let index = 0; index + 1 < cuts.length; index++) {
			const from = cuts[index] as number
			const to = cuts[index + 1] as number
			if (from === to) continue
			const range = ranges.find((candidate) => from >= candidate.from && to <= candidate.to)
			const extra = range === undefined ? '' : markClass(range.severity)
			html += span(token.kind, token.text.slice(from - offset, to - offset), extra)
		}
		offset = end
	}
	return html
}

/**
 * Renders the whole document as highlighted HTML, one text line per line, with diagnostics underlined.
 */
export function renderLines(text: string, diagnostics: readonly Diagnostic[]): string {
	const lines = text.split('\n')
	const byLine = new Map<number, LineRange[]>()
	for (const item of diagnostics) {
		for (let line = item.line; line <= Math.min(item.endLine, lines.length - 1); line++) {
			const length = (lines[line] ?? '').length
			let from = line === item.line ? item.character : 0
			let to = line === item.endLine ? item.endCharacter : length
			if (from >= length) from = Math.max(0, length - 1)
			if (to <= from) to = Math.min(length, from + 1)
			const list = byLine.get(line) ?? []
			list.push({ from, to, severity: item.severity })
			byLine.set(line, list)
		}
	}
	let state: LineState = 'code'
	const html: string[] = []
	for (let index = 0; index < lines.length; index++) {
		const result = tokenizeLine(lines[index] ?? '', state)
		state = result.state
		html.push(renderLine(result.tokens, byLine.get(index) ?? []))
	}
	return html.join('\n')
}
