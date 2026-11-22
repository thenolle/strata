import { nodeSpec } from './nodes.ts'
import type { FlowContext, GraphData, GraphEdge, GraphNode, NodeSpec, PinSpec, PinType } from './types.ts'

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const MAX_NODES = 2000
const MAX_EDGES = 5000

export type CompileResult = { readonly ok: true; readonly code: string } | { readonly ok: false; readonly errors: readonly string[] }

const key = (node: string, pin: string): string => `${node}.${pin}`
const compatible = (from: PinType, to: PinType): boolean => from === to || from === 'any' || to === 'any'

function enclosed(text: string): boolean {
	if (!text.startsWith('(') || !text.endsWith(')')) return false
	let depth = 0
	for (let index = 0; index < text.length; index++) {
		const char = text.charAt(index)
		if (char === '(') depth++
		else if (char === ')' && --depth === 0 && index < text.length - 1) return false
	}
	return depth === 0
}

/** Wraps an expression in parentheses unless it is a plain name, a string literal or already enclosed. */
const wrap = (text: string): string => (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(text) || /^"(?:[^"\\]|\\.)*"$/.test(text) || enclosed(text) ? text : `(${text})`)

/**
 * The code for a value typed into a pin. Text becomes a quoted literal and numbers are checked, so no value can add code of its own.
 */
function literal(type: PinType, value: unknown): string {
	switch (type) {
		case 'string':
			return JSON.stringify(typeof value === 'string' ? value : String(value ?? ''))
		case 'boolean':
			return value === true || value === 'true' ? 'true' : 'false'
		case 'vec2':
			return 'S.Vec2.zero'
		case 'color':
			return 'S.COLORS.white'
		case 'entity':
			return 'ctx.entity'
		case 'flow':
			return 'undefined'
		case 'any':
			return typeof value === 'string' ? JSON.stringify(value) : typeof value === 'boolean' ? String(value) : String(Number.isFinite(Number(value)) ? Number(value) : 0)
		default:
			return String(Number.isFinite(Number(value)) ? Number(value) : 0)
	}
}

/**
 * Turns a graph into the source of a TypeScript script. Fails with a list of readable problems instead of producing broken code.
 */
export function compileGraph(graph: GraphData, className = 'GraphScript'): CompileResult {
	const errors: string[] = []
	if (!IDENT.test(className)) return { ok: false, errors: ['The class name must be a plain identifier'] }
	if (graph.nodes.length > MAX_NODES || graph.edges.length > MAX_EDGES) return { ok: false, errors: ['The graph is too large'] }

	const byId = new Map<string, GraphNode>()
	for (const node of graph.nodes) {
		if (!IDENT.test(node.id)) errors.push(`"${node.id}" is not a valid node id`)
		else if (byId.has(node.id)) errors.push(`The node id "${node.id}" is used twice`)
		else if (nodeSpec(node.type) === undefined) errors.push(`Unknown node type "${node.type}"`)
		else byId.set(node.id, node)
	}
	const names = new Set<string>()
	for (const variable of graph.variables) {
		if (!IDENT.test(variable.name) || names.has(variable.name)) errors.push(`"${variable.name}" is not a valid or unique variable name`)
		names.add(variable.name)
	}

	const incoming = new Map<string, GraphEdge>()
	const flowOut = new Map<string, GraphEdge>()
	for (const edge of graph.edges) {
		const from = byId.get(edge.from.node)
		const to = byId.get(edge.to.node)
		const fromPin = from === undefined ? undefined : nodeSpec(from.type)?.outputs.find((pin) => pin.name === edge.from.pin)
		const toPin = to === undefined ? undefined : nodeSpec(to.type)?.inputs.find((pin) => pin.name === edge.to.pin)
		if (from === undefined || to === undefined || fromPin === undefined || toPin === undefined) {
			errors.push(`A connection refers to a node or pin that does not exist (${edge.from.node}.${edge.from.pin} to ${edge.to.node}.${edge.to.pin})`)
			continue
		}
		if ((fromPin.type === 'flow') !== (toPin.type === 'flow')) errors.push('A flow pin connects only to a flow pin')
		else if (fromPin.type === 'flow') {
			if (flowOut.has(key(from.id, fromPin.name))) errors.push(`${from.type}.${fromPin.name} has two connections`)
			else flowOut.set(key(from.id, fromPin.name), edge)
		} else if (!compatible(fromPin.type, toPin.type)) errors.push(`${from.type}.${fromPin.name} (${fromPin.type}) cannot connect to ${to.type}.${toPin.name} (${toPin.type})`)
		else if (incoming.has(key(to.id, toPin.name))) errors.push(`${to.type}.${toPin.name} has two connections`)
		else incoming.set(key(to.id, toPin.name), edge)
	}

	const fields = new Map<string, string>()
	const resolving = new Set<string>()
	const visiting = new Set<string>()
	let pre: string[] = []
	let memo = new Map<string, string>()
	let counter = 0

	const variableName = (node: GraphNode): string => {
		const name = node.values['name']
		if (typeof name !== 'string' || !names.has(name)) {
			errors.push(`${node.id}: choose a variable that exists`)
			return '_missing'
		}
		return name
	}

	function input(node: GraphNode, pin: PinSpec): string {
		const edge = incoming.get(key(node.id, pin.name))
		const source = edge === undefined ? undefined : byId.get(edge.from.node)
		if (edge === undefined || source === undefined) return literal(pin.type, node.values[pin.name] ?? pin.default)
		return output(source, edge.from.pin)
	}

	function output(node: GraphNode, pinName: string): string {
		const spec = nodeSpec(node.type)
		if (spec === undefined) return '0'
		if (spec.flow !== undefined) return spec.flow.outputExpr?.(node.id, pinName) ?? '0'
		if (spec.id === 'variable.get') return `this.v_${variableName(node)}`
		const cacheKey = key(node.id, pinName)
		const known = memo.get(cacheKey)
		if (known !== undefined) return known
		if (resolving.has(node.id)) {
			errors.push(`The data connections of "${node.id}" form a loop`)
			return '0'
		}
		resolving.add(node.id)
		const args = new Map(spec.inputs.map((pin): [string, string] => [pin.name, wrap(input(node, pin))]))
		resolving.delete(node.id)
		const index = Math.max(0, spec.outputs.findIndex((pin) => pin.name === pinName))
		let code = (spec.expr?.[index] ?? '0').replace(/\{(\w+)\}/g, (_match, name: string) => args.get(name) ?? '0')
		if (spec.needs === 'random') fields.set('#random', '#random = new S.Random()')
		if (spec.needs === 'noise') fields.set('#noise', '#noise = new S.Noise(0)')
		if (spec.impure === true) {
			const temp = `_t${++counter}`
			pre.push(`const ${temp} = ${code}`)
			code = temp
		}
		memo.set(cacheKey, code)
		return code
	}

	const context = (node: GraphNode, spec: NodeSpec): FlowContext => ({
		node,
		id: node.id,
		input: (pin) => {
			const found = spec.inputs.find((candidate) => candidate.name === pin)
			return found === undefined ? '0' : input(node, found)
		},
		block: (pin) => block(node, pin),
		field: (name, initial) => {
			fields.set(name, `${name} = ${initial}`)
		},
		variable: () => `this.v_${variableName(node)}`
	})

	function statement(node: GraphNode): string[] {
		const spec = nodeSpec(node.type)
		if (spec?.flow === undefined) return []
		if (visiting.has(node.id)) {
			errors.push(`The flow through "${node.id}" loops back on itself. Use a loop node instead.`)
			return []
		}
		visiting.add(node.id)
		const savedPre = pre
		const savedMemo = memo
		pre = []
		memo = new Map()
		const lines = spec.flow.emit(context(node, spec))
		const result = [...pre, ...lines]
		pre = savedPre
		memo = savedMemo
		visiting.delete(node.id)
		return result
	}

	function block(node: GraphNode, pin: string): string[] {
		const edge = flowOut.get(key(node.id, pin))
		const target = edge === undefined ? undefined : byId.get(edge.to.node)
		return target === undefined ? [] : statement(target)
	}

	const hooks: Record<'onStart' | 'onUpdate', string[]> = { onStart: [], onUpdate: [] }
	for (const node of byId.values()) {
		const event = nodeSpec(node.type)?.event
		if (event !== undefined) hooks[event].push(...statement(node))
	}
	if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] }

	const lines = ["import type { Script, ScriptContext } from 'strata'", "import * as S from 'strata'", '', `export default class ${className} implements Script {`]
	for (const variable of graph.variables) lines.push(`\tv_${variable.name} = ${literal(variable.type, variable.value)}`)
	for (const declaration of fields.values()) lines.push(`\t${declaration}`)
	for (const hook of ['onStart', 'onUpdate'] as const) {
		if (hooks[hook].length === 0) continue
		lines.push('', `\t${hook}(ctx: ScriptContext): void {`, ...hooks[hook].map((line) => `\t\t${line}`), '\t}')
	}
	lines.push('}', '')
	return { ok: true, code: lines.join('\n') }
}
