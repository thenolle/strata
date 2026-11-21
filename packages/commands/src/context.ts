import { Emitter, StrataError, err, ok, type Result } from '@strata/core'

export type ContextValue = string | number | boolean | undefined
type Comparison = '==' | '!=' | '<' | '<=' | '>' | '>='

export type WhenNode =
	| { readonly kind: 'key'; readonly name: string }
	| { readonly kind: 'literal'; readonly value: boolean }
	| { readonly kind: 'not'; readonly operand: WhenNode }
	| { readonly kind: 'and'; readonly left: WhenNode; readonly right: WhenNode }
	| { readonly kind: 'or'; readonly left: WhenNode; readonly right: WhenNode }
	| { readonly kind: 'compare'; readonly operator: Comparison; readonly name: string; readonly value: string | number | boolean }
	| { readonly kind: 'match'; readonly name: string; readonly pattern: RegExp }

interface Token {
	readonly kind: 'word' | 'string' | 'regex' | 'operator'
	readonly text: string
}

const OPERATORS = ['&&', '||', '==', '!=', '<=', '>=', '=~', '!', '<', '>', '(', ')']
const COMPARISONS = new Set(['==', '!=', '<', '<=', '>', '>='])
const WORD = /^[A-Za-z0-9_.:\-]+/
const NUMBER = /^-?\d+(\.\d+)?$/
const MAX_REGEX_LENGTH = 200

function tokenize(source: string): Token[] {
	const tokens: Token[] = []
	let index = 0
	while (index < source.length) {
		const rest = source.slice(index)
		const space = /^\s+/.exec(rest)
		if (space !== null) {
			index += space[0].length
			continue
		}
		const operator = OPERATORS.find((candidate) => rest.startsWith(candidate))
		if (operator !== undefined) {
			tokens.push({ kind: 'operator', text: operator })
			index += operator.length
			continue
		}
		const first = rest.charAt(0)
		if (first === "'" || first === '"') {
			const end = rest.indexOf(first, 1)
			if (end < 0) throw new SyntaxError('Unterminated string')
			tokens.push({ kind: 'string', text: rest.slice(1, end) })
			index += end + 1
			continue
		}
		if (first === '/') {
			const match = /^\/(?:\\.|[^/\\])+\/[a-z]*/.exec(rest)
			if (match === null) throw new SyntaxError('Malformed regular expression')
			tokens.push({ kind: 'regex', text: match[0] })
			index += match[0].length
			continue
		}
		const word = WORD.exec(rest)
		if (word === null) throw new SyntaxError(`Unexpected character "${first}"`)
		tokens.push({ kind: 'word', text: word[0] })
		index += word[0].length
	}
	return tokens
}

class Parser {
	readonly #tokens: readonly Token[]
	#position = 0

	constructor(tokens: readonly Token[]) {
		this.#tokens = tokens
	}

	parse(): WhenNode {
		const node = this.#or()
		const leftover = this.#tokens[this.#position]
		if (leftover !== undefined) throw new SyntaxError(`Unexpected "${leftover.text}"`)
		return node
	}

	#or(): WhenNode {
		let left = this.#and()
		while (this.#accept('||')) left = { kind: 'or', left, right: this.#and() }
		return left
	}

	#and(): WhenNode {
		let left = this.#unary()
		while (this.#accept('&&')) left = { kind: 'and', left, right: this.#unary() }
		return left
	}

	#unary(): WhenNode {
		if (this.#accept('!')) return { kind: 'not', operand: this.#unary() }
		return this.#primary()
	}

	#primary(): WhenNode {
		if (this.#accept('(')) {
			const inner = this.#or()
			if (!this.#accept(')')) throw new SyntaxError('Missing closing parenthesis')
			return inner
		}
		const token = this.#tokens[this.#position++]
		if (token === undefined) throw new SyntaxError('Unexpected end of expression')
		if (token.kind !== 'word') throw new SyntaxError(`Unexpected "${token.text}"`)
		const next = this.#tokens[this.#position]
		if (next?.kind === 'operator' && COMPARISONS.has(next.text)) {
			this.#position++
			return { kind: 'compare', operator: next.text as Comparison, name: token.text, value: this.#value() }
		}
		if (next?.kind === 'operator' && next.text === '=~') {
			this.#position++
			return this.#match(token.text)
		}
		if (token.text === 'true' || token.text === 'false') return { kind: 'literal', value: token.text === 'true' }
		return { kind: 'key', name: token.text }
	}

	#value(): string | number | boolean {
		const token = this.#tokens[this.#position++]
		if (token === undefined) throw new SyntaxError('Missing value after comparison')
		if (token.kind === 'string') return token.text
		if (token.kind !== 'word') throw new SyntaxError(`Unexpected "${token.text}"`)
		if (token.text === 'true') return true
		if (token.text === 'false') return false
		return NUMBER.test(token.text) ? Number(token.text) : token.text
	}

	#match(name: string): WhenNode {
		const token = this.#tokens[this.#position++]
		const parts = token?.kind === 'regex' ? /^\/(.*)\/([a-z]*)$/.exec(token.text) : null
		if (token === undefined || parts === null) throw new SyntaxError('Expected a /regular expression/ after =~')
		const source = parts[1] ?? ''
		if (source.length > MAX_REGEX_LENGTH) throw new SyntaxError('Regular expression is too long')
		return { kind: 'match', name, pattern: new RegExp(source, (parts[2] ?? '').replace(/[gy]/g, '')) }
	}

	#accept(text: string): boolean {
		const token = this.#tokens[this.#position]
		if (token?.kind === 'operator' && token.text === text) {
			this.#position++
			return true
		}
		return false
	}
}

/**
 * Parses a `when` clause: context keys combined with `!`, `&&`, `||`, parentheses, comparisons and `=~` matches.
 */
export function parseWhen(source: string): Result<WhenNode> {
	try {
		return ok(new Parser(tokenize(source)).parse())
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error)
		return err(new StrataError('invalid-format', `Invalid when clause "${source}": ${message}`, { cause: error }))
	}
}

function compare(operator: Comparison, actual: ContextValue, expected: string | number | boolean): boolean {
	if (operator === '==') return actual === expected || (actual !== undefined && String(actual) === String(expected))
	if (operator === '!=') return !compare('==', actual, expected)
	const left = Number(actual)
	const right = Number(expected)
	if (Number.isNaN(left) || Number.isNaN(right)) return false
	if (operator === '<') return left < right
	if (operator === '<=') return left <= right
	return operator === '>' ? left > right : left >= right
}

export function evaluateWhen(node: WhenNode, lookup: (name: string) => ContextValue): boolean {
	switch (node.kind) {
		case 'key': return Boolean(lookup(node.name))
		case 'literal': return node.value
		case 'not': return !evaluateWhen(node.operand, lookup)
		case 'and': return evaluateWhen(node.left, lookup) && evaluateWhen(node.right, lookup)
		case 'or': return evaluateWhen(node.left, lookup) || evaluateWhen(node.right, lookup)
		case 'compare': return compare(node.operator, lookup(node.name), node.value)
		case 'match': {
			const value = lookup(node.name)
			return value !== undefined && node.pattern.test(String(value))
		}
	}
}

/**
 * The named facts about the current UI state that `when` clauses are evaluated against.
 */
export class ContextKeys {
	readonly changed = new Emitter<string>()
	readonly #values = new Map<string, ContextValue>()

	get(name: string): ContextValue {
		return this.#values.get(name)
	}

	set(name: string, value: ContextValue): void {
		if (this.#values.get(name) === value) return
		if (value === undefined) this.#values.delete(name)
		else this.#values.set(name, value)
		this.changed.emit(name)
	}

	evaluate(node: WhenNode): boolean {
		return evaluateWhen(node, (name) => this.#values.get(name))
	}
}
