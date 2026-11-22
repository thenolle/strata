import { tokenizeLine, type LineState } from './highlight.ts'

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)]*\))/g

export interface MarkdownOptions {
	/** When set, code blocks get an Insert button. */
	readonly onInsert?: (code: string) => void
}

function inline(parent: HTMLElement, text: string): void {
	let cursor = 0
	for (const match of text.matchAll(INLINE)) {
		const index = match.index ?? 0
		if (index > cursor) parent.append(text.slice(cursor, index))
		const part = match[0]
		let element: HTMLElement
		if (part.startsWith('`')) {
			element = document.createElement('code')
			element.textContent = part.slice(1, -1)
		} else if (part.startsWith('**')) {
			element = document.createElement('strong')
			element.textContent = part.slice(2, -2)
		} else if (part.startsWith('[')) {
			element = document.createElement('span')
			element.className = 'md-link'
			element.textContent = part.slice(1, part.indexOf(']'))
		} else {
			element = document.createElement('em')
			element.textContent = part.slice(1, -1)
		}
		parent.append(element)
		cursor = index + part.length
	}
	if (cursor < text.length) parent.append(text.slice(cursor))
}

function highlighted(code: string): HTMLPreElement {
	const pre = document.createElement('pre')
	let state: LineState = 'code'
	for (const [index, line] of code.split('\n').entries()) {
		if (index > 0) pre.append('\n')
		const result = tokenizeLine(line, state)
		state = result.state
		for (const token of result.tokens) {
			if (token.kind === 'plain') {
				pre.append(token.text)
				continue
			}
			const span = document.createElement('span')
			span.className = `tok-${token.kind}`
			span.textContent = token.text
			pre.append(span)
		}
	}
	return pre
}

/**
 * Renders a small Markdown subset (headings, paragraphs, bullet lists, inline code and fenced code) without using innerHTML.
 */
export function renderMarkdown(source: string, options: MarkdownOptions = {}): DocumentFragment {
	const fragment = document.createDocumentFragment()
	const lines = source.replaceAll('\r\n', '\n').split('\n')
	let paragraph: string[] = []
	let list: HTMLUListElement | undefined
	const flush = (): void => {
		if (paragraph.length > 0) {
			const element = document.createElement('p')
			inline(element, paragraph.join(' '))
			fragment.append(element)
			paragraph = []
		}
		list = undefined
	}
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? ''
		if (line.startsWith('```')) {
			flush()
			const code: string[] = []
			index++
			while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
				code.push(lines[index] ?? '')
				index++
			}
			const text = code.join('\n')
			const block = document.createElement('div')
			block.className = 'md-code'
			block.append(highlighted(text))
			if (options.onInsert !== undefined) {
				const button = document.createElement('button')
				button.type = 'button'
				button.textContent = 'Insert'
				button.addEventListener('click', () => options.onInsert?.(text))
				block.append(button)
			}
			fragment.append(block)
			continue
		}
		const heading = /^(#{1,3})\s+(.*)$/.exec(line)
		if (heading !== null) {
			flush()
			const element = document.createElement(`h${Math.min(4, (heading[1] ?? '#').length + 1)}`)
			inline(element, heading[2] ?? '')
			fragment.append(element)
			continue
		}
		const bullet = /^[-*]\s+(.*)$/.exec(line)
		if (bullet !== null) {
			if (paragraph.length > 0) {
				const element = document.createElement('p')
				inline(element, paragraph.join(' '))
				fragment.append(element)
				paragraph = []
			}
			if (list === undefined) {
				list = document.createElement('ul')
				fragment.append(list)
			}
			const item = document.createElement('li')
			inline(item, bullet[1] ?? '')
			list.append(item)
			continue
		}
		if (line.trim() === '') {
			flush()
			continue
		}
		paragraph.push(line.trim())
	}
	flush()
	return fragment
}
