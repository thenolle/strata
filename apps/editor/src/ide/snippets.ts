export interface Snippet {
	readonly label: string
	readonly detail: string
	readonly body: string
}

export interface SnippetStop {
	readonly index: number
	start: number
	end: number
}

export interface Expanded {
	readonly text: string
	readonly stops: SnippetStop[]
}

export const SNIPPETS: readonly Snippet[] = [
	{ label: 'onstart', detail: 'Start hook', body: 'onStart(ctx: ScriptContext): void {\n\t$0\n}' },
	{ label: 'onupdate', detail: 'Update hook', body: "onUpdate(ctx: ScriptContext): void {\n\tconst transform = ctx.get('transform')\n\tif (transform === undefined) return\n\t$0\n}" },
	{ label: 'script', detail: 'New script class', body: "import type { Script, ScriptContext } from 'strata'\n\nexport default class ${1:NewScript} implements Script {\n\tonStart(ctx: ScriptContext): void {\n\t\t$0\n\t}\n}\n" },
	{ label: 'for', detail: 'Counting loop', body: 'for (let i = 0; i < ${1:count}; i++) {\n\t$0\n}' },
	{ label: 'forof', detail: 'For each item', body: 'for (const ${1:item} of ${2:items}) {\n\t$0\n}' },
	{ label: 'if', detail: 'If statement', body: 'if (${1:condition}) {\n\t$0\n}' },
	{ label: 'ifelse', detail: 'If and else', body: 'if (${1:condition}) {\n\t$2\n} else {\n\t$0\n}' },
	{ label: 'try', detail: 'Try and catch', body: 'try {\n\t$1\n} catch (error: unknown) {\n\t$0\n}' },
	{ label: 'fn', detail: 'Function', body: 'function ${1:name}(${2:value: number}): ${3:void} {\n\t$0\n}' },
	{ label: 'log', detail: 'Log a message', body: 'ctx.log($1)' },
	{ label: 'clamp', detail: 'Limit a value', body: 'Math.min(Math.max(${1:value}, ${2:min}), ${3:max})' }
]

/**
 * Turns a snippet into text and tab stops. Later stops with the same number are plain text, $0 is the final stop.
 */
export function expandSnippet(body: string, indent: string): Expanded {
	let text = ''
	const stops: SnippetStop[] = []
	const seen = new Set<number>()
	let index = 0
	while (index < body.length) {
		const char = body.charAt(index)
		if (char === '\n') {
			text += `\n${indent}`
			index++
			continue
		}
		if (char === '$') {
			const braced = /^\$\{(\d+)(?::([^}]*))?\}/.exec(body.slice(index))
			const match = braced ?? /^\$(\d+)/.exec(body.slice(index))
			if (match !== null) {
				const number = Number(match[1])
				const start = text.length
				text += braced?.[2] ?? ''
				if (!seen.has(number)) {
					seen.add(number)
					stops.push({ index: number, start, end: text.length })
				}
				index += match[0].length
				continue
			}
		}
		text += char
		index++
	}
	if (!seen.has(0)) stops.push({ index: 0, start: text.length, end: text.length })
	stops.sort((a, b) => (a.index === 0 ? Infinity : a.index) - (b.index === 0 ? Infinity : b.index))
	return { text, stops }
}
