export interface MarkdownOptions {
	/** When set, code blocks get an Insert button. */
	readonly onInsert?: (code: string) => void
}

function inline(parent: HTMLElement, text: string): void {
	for (const [index, part] of text.split('`').entries()) {
		if (part === '') continue
		if (index % 2 === 1) {
			const code = document.createElement('code')
			code.textContent = part
			parent.append(code)
		} else {
			parent.append(part)
		}
	}
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
			const pre = document.createElement('pre')
			pre.textContent = text
			block.append(pre)
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
