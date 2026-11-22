import { graph as G } from '@strata/scripting'
import { quickPick } from './ide/quick-pick.ts'

const SVG = 'http://www.w3.org/2000/svg'
type Values = Record<string, number | string | boolean>
interface MNode {
	id: string
	type: string
	x: number
	y: number
	values: Values
}
type Drag =
	| { readonly kind: 'pan'; x: number; y: number }
	| { readonly kind: 'nodes'; x: number; y: number; moved: boolean }
	| { readonly kind: 'wire'; readonly from: HTMLElement; point: { x: number; y: number } }

const compatible = (a: G.PinType, b: G.PinType): boolean => (a === 'flow') === (b === 'flow') && (a === b || a === 'any' || b === 'any')

export function emptyGraphText(): string {
	return JSON.stringify({ format: 'strata.graph', variables: [], nodes: [{ id: 'update', type: 'event.update', x: 60, y: 60, values: {} }], edges: [] }, null, 2)
}

export function parseGraph(text: string): G.GraphData | undefined {
	try {
		const data = JSON.parse(text) as Partial<G.GraphData> | null
		if (data?.format !== 'strata.graph' || !Array.isArray(data.nodes) || !Array.isArray(data.edges) || !Array.isArray(data.variables)) return undefined
		return data as G.GraphData
	} catch {
		return undefined
	}
}

/**
 * A node graph canvas built from plain elements and one SVG layer for the wires.
 */
export class GraphView {
	readonly element = document.createElement('div')
	readonly #world = document.createElement('div')
	readonly #wires = document.createElementNS(SVG, 'svg')
	readonly #nodes = new Map<string, MNode>()
	readonly #boxes = new Map<string, HTMLElement>()
	readonly #dots = new Map<string, HTMLElement>()
	readonly #selected = new Set<string>()
	readonly #onChange: () => void
	#edges: G.GraphEdge[]
	#variables: G.GraphVariable[]
	#pan = { x: 40, y: 40 }
	#zoom = 1
	#counter = 0
	#cursor = { x: 80, y: 80 }
	#pick: (() => void) | undefined
	#drag: Drag | undefined

	constructor(data: G.GraphData, onChange: () => void) {
		this.#onChange = onChange
		for (const node of data.nodes) {
			this.#nodes.set(node.id, { id: node.id, type: node.type, x: node.x, y: node.y, values: { ...node.values } })
			const number = /^n(\d+)$/.exec(node.id)?.[1]
			if (number !== undefined) this.#counter = Math.max(this.#counter, Number(number))
		}
		this.#edges = data.edges.map((edge) => ({ from: { ...edge.from }, to: { ...edge.to } }))
		this.#variables = data.variables.map((variable) => ({ ...variable }))
		this.element.className = 'gv'
		this.element.tabIndex = 0
		this.#world.className = 'gv-world'
		this.#wires.setAttribute('class', 'gv-wires')
		this.#world.append(this.#wires)
		this.element.append(this.#world)
		this.element.addEventListener('pointerdown', this.#onDown)
		this.element.addEventListener('pointermove', this.#onMove)
		this.element.addEventListener('pointerup', this.#onUp)
		this.element.addEventListener('wheel', this.#onWheel, { passive: false })
		this.element.addEventListener('dblclick', this.#onDouble)
		this.element.addEventListener('keydown', this.#onKey)
		this.render()
	}

	get variables(): readonly G.GraphVariable[] {
		return this.#variables
	}

	toData(): G.GraphData {
		return {
			format: 'strata.graph',
			variables: this.#variables.map((variable) => ({ ...variable })),
			nodes: [...this.#nodes.values()].map((node) => ({ id: node.id, type: node.type, x: Math.round(node.x), y: Math.round(node.y), values: { ...node.values } })),
			edges: this.#edges.map((edge) => ({ from: { ...edge.from }, to: { ...edge.to } }))
		}
	}

	addVariable(variable: G.GraphVariable): boolean {
		if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(variable.name) || this.#variables.some((existing) => existing.name === variable.name)) return false
		this.#variables.push(variable)
		this.render()
		this.#onChange()
		return true
	}

	removeVariable(name: string): void {
		this.#variables = this.#variables.filter((variable) => variable.name !== name)
		this.render()
		this.#onChange()
	}

	openPicker(at = this.#cursor): void {
		this.#pick?.()
		const items = G.listNodes().map((spec) => ({ label: `${spec.category} › ${spec.title}`, detail: spec.id, value: spec.id }))
		this.#pick = quickPick(this.element, {
			placeholder: 'Add a node',
			items,
			onPick: (type) => this.addNode(type, at.x, at.y),
			onClose: () => {
				this.#pick = undefined
				this.element.focus()
			}
		})
	}

	addNode(type: string, x: number, y: number): void {
		const id = `n${++this.#counter}`
		this.#nodes.set(id, { id, type, x, y, values: {} })
		this.#selected.clear()
		this.#selected.add(id)
		this.render()
		this.#onChange()
	}

	deleteSelected(): void {
		if (this.#selected.size === 0) return
		for (const id of this.#selected) this.#nodes.delete(id)
		this.#edges = this.#edges.filter((edge) => !this.#selected.has(edge.from.node) && !this.#selected.has(edge.to.node))
		this.#selected.clear()
		this.render()
		this.#onChange()
	}

	render(): void {
		for (const box of this.#boxes.values()) box.remove()
		this.#boxes.clear()
		this.#dots.clear()
		for (const node of this.#nodes.values()) {
			const box = this.#box(node)
			this.#boxes.set(node.id, box)
			this.#world.append(box)
		}
		this.#applyView()
		this.#drawWires()
	}

	#applyView(): void {
		this.#world.style.transform = `translate(${this.#pan.x}px, ${this.#pan.y}px) scale(${this.#zoom})`
	}

	#toWorld(clientX: number, clientY: number): { x: number; y: number } {
		const rect = this.element.getBoundingClientRect()
		return { x: (clientX - rect.left - this.#pan.x) / this.#zoom, y: (clientY - rect.top - this.#pan.y) / this.#zoom }
	}

	#box(node: MNode): HTMLElement {
		const spec = G.nodeSpec(node.type)
		const box = document.createElement('div')
		box.className = 'gv-node'
		box.dataset['id'] = node.id
		box.dataset['selected'] = String(this.#selected.has(node.id))
		box.dataset['category'] = spec?.category ?? 'Unknown'
		box.style.left = `${node.x}px`
		box.style.top = `${node.y}px`
		const title = document.createElement('div')
		title.className = 'gv-title'
		title.textContent = spec?.title ?? `Unknown: ${node.type}`
		box.append(title)
		if (spec === undefined) return box
		if (spec.id.startsWith('variable.')) box.append(this.#variablePicker(node))
		for (let index = 0; index < Math.max(spec.inputs.length, spec.outputs.length); index++) {
			const row = document.createElement('div')
			row.className = 'gv-row'
			const input = spec.inputs[index]
			const output = spec.outputs[index]
			row.append(input === undefined ? document.createElement('span') : this.#pin(node, input, 'in'), output === undefined ? document.createElement('span') : this.#pin(node, output, 'out'))
			box.append(row)
		}
		return box
	}

	#variablePicker(node: MNode): HTMLElement {
		const select = document.createElement('select')
		select.className = 'gv-value'
		for (const variable of this.#variables) {
			const option = document.createElement('option')
			option.value = variable.name
			option.textContent = variable.name
			option.selected = node.values['name'] === variable.name
			select.append(option)
		}
		if (this.#variables.length === 0) {
			const none = document.createElement('option')
			none.textContent = '(add a variable first)'
			select.append(none)
			select.disabled = true
		} else if (typeof node.values['name'] !== 'string') node.values['name'] = this.#variables[0]?.name ?? ''
		select.addEventListener('change', () => {
			node.values['name'] = select.value
			this.#onChange()
		})
		select.addEventListener('pointerdown', (event) => event.stopPropagation())
		return select
	}

	#pin(node: MNode, pin: G.PinSpec, direction: 'in' | 'out'): HTMLElement {
		const cell = document.createElement('div')
		cell.className = `gv-pin gv-${direction}`
		const dot = document.createElement('span')
		dot.className = `gv-dot gv-type-${pin.type}`
		dot.dataset['node'] = node.id
		dot.dataset['pin'] = pin.name
		dot.dataset['dir'] = direction
		dot.dataset['type'] = pin.type
		this.#dots.set(`${node.id}.${pin.name}.${direction}`, dot)
		const label = document.createElement('span')
		label.className = 'gv-label'
		label.textContent = pin.name === 'exec' ? '' : pin.name
		cell.append(dot, label)
		const connected = this.#edges.some((edge) => edge.to.node === node.id && edge.to.pin === pin.name)
		if (direction === 'in' && pin.type !== 'flow' && !connected) {
			const editor = this.#editor(node, pin)
			if (editor !== undefined) cell.append(editor)
		}
		return cell
	}

	#editor(node: MNode, pin: G.PinSpec): HTMLElement | undefined {
		if (pin.type === 'vec2' || pin.type === 'color' || pin.type === 'entity') return undefined
		const current = node.values[pin.name] ?? pin.default
		const input = document.createElement('input')
		if (pin.type === 'boolean') {
			input.type = 'checkbox'
			input.checked = current === true || current === 'true'
			input.addEventListener('change', () => {
				node.values[pin.name] = input.checked
				this.#onChange()
			})
		} else {
			input.type = 'text'
			input.className = 'gv-value'
			input.value = current === undefined ? (pin.type === 'string' ? '' : '0') : String(current)
			input.addEventListener('input', () => {
				const text = input.value
				node.values[pin.name] =
					pin.type === 'number' ? Number(text) || 0 : pin.type === 'any' ? (text === 'true' ? true : text === 'false' ? false : text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : text) : text
				this.#onChange()
			})
		}
		input.addEventListener('pointerdown', (event) => event.stopPropagation())
		input.addEventListener('keydown', (event) => event.stopPropagation())
		return input
	}

	#center(dot: HTMLElement | undefined): { x: number; y: number } | undefined {
		if (dot === undefined) return undefined
		const world = this.#world.getBoundingClientRect()
		const rect = dot.getBoundingClientRect()
		return { x: (rect.left + rect.width / 2 - world.left) / this.#zoom, y: (rect.top + rect.height / 2 - world.top) / this.#zoom }
	}

	#path(a: { x: number; y: number }, b: { x: number; y: number }, type: string, edge?: number): SVGPathElement {
		const path = document.createElementNS(SVG, 'path')
		const bend = Math.max(40, Math.abs(b.x - a.x) / 2)
		path.setAttribute('d', `M ${a.x} ${a.y} C ${a.x + bend} ${a.y}, ${b.x - bend} ${b.y}, ${b.x} ${b.y}`)
		path.setAttribute('class', `gv-wire gv-type-${type}`)
		if (edge !== undefined) path.dataset['edge'] = String(edge)
		return path
	}

	#drawWires(temporary?: { from: { x: number; y: number }; to: { x: number; y: number }; type: string }): void {
		this.#wires.replaceChildren()
		this.#edges.forEach((edge, index) => {
			const outDot = this.#dots.get(`${edge.from.node}.${edge.from.pin}.out`)
			const a = this.#center(outDot)
			const b = this.#center(this.#dots.get(`${edge.to.node}.${edge.to.pin}.in`))
			if (a !== undefined && b !== undefined) this.#wires.append(this.#path(a, b, outDot?.dataset['type'] ?? 'any', index))
		})
		if (temporary !== undefined) this.#wires.append(this.#path(temporary.from, temporary.to, temporary.type))
	}

	#paintSelection(): void {
		for (const [id, box] of this.#boxes) box.dataset['selected'] = String(this.#selected.has(id))
	}

	#connect(a: HTMLElement, b: HTMLElement | undefined): void {
		if (b === undefined) return
		const [out, input] = a.dataset['dir'] === 'out' ? [a, b] : [b, a]
		if (out.dataset['dir'] !== 'out' || input.dataset['dir'] !== 'in' || out.dataset['node'] === input.dataset['node']) return
		const outType = (out.dataset['type'] ?? 'any') as G.PinType
		const inType = (input.dataset['type'] ?? 'any') as G.PinType
		if (!compatible(outType, inType)) return
		const edge: G.GraphEdge = { from: { node: out.dataset['node'] ?? '', pin: out.dataset['pin'] ?? '' }, to: { node: input.dataset['node'] ?? '', pin: input.dataset['pin'] ?? '' } }
		this.#edges = this.#edges.filter(
			(existing) => !(inType !== 'flow' && existing.to.node === edge.to.node && existing.to.pin === edge.to.pin) && !(outType === 'flow' && existing.from.node === edge.from.node && existing.from.pin === edge.from.pin)
		)
		this.#edges.push(edge)
		this.render()
		this.#onChange()
	}

	readonly #onDown = (event: PointerEvent): void => {
		const target = event.target as HTMLElement
		if (target.closest('.ide-pick') !== null) return
		this.element.focus()
		this.element.setPointerCapture(event.pointerId)
		const dot = target.closest<HTMLElement>('.gv-dot')
		const box = target.closest<HTMLElement>('.gv-node')
		if (dot !== null && event.button === 0) {
			this.#drag = { kind: 'wire', from: dot, point: this.#toWorld(event.clientX, event.clientY) }
		} else if (box !== null && event.button === 0) {
			const id = box.dataset['id'] ?? ''
			if (event.shiftKey) {
				if (this.#selected.has(id)) this.#selected.delete(id)
				else this.#selected.add(id)
			} else if (!this.#selected.has(id)) {
				this.#selected.clear()
				this.#selected.add(id)
			}
			this.#paintSelection()
			this.#drag = { kind: 'nodes', x: event.clientX, y: event.clientY, moved: false }
		} else {
			if (event.button === 0 && !event.shiftKey) {
				this.#selected.clear()
				this.#paintSelection()
			}
			this.#drag = { kind: 'pan', x: event.clientX, y: event.clientY }
		}
	}

	readonly #onMove = (event: PointerEvent): void => {
		this.#cursor = this.#toWorld(event.clientX, event.clientY)
		const drag = this.#drag
		if (drag === undefined) return
		if (drag.kind === 'pan') {
			this.#pan = { x: this.#pan.x + event.clientX - drag.x, y: this.#pan.y + event.clientY - drag.y }
			drag.x = event.clientX
			drag.y = event.clientY
			this.#applyView()
		} else if (drag.kind === 'nodes') {
			const dx = (event.clientX - drag.x) / this.#zoom
			const dy = (event.clientY - drag.y) / this.#zoom
			drag.x = event.clientX
			drag.y = event.clientY
			drag.moved = true
			for (const id of this.#selected) {
				const node = this.#nodes.get(id)
				const box = this.#boxes.get(id)
				if (node === undefined || box === undefined) continue
				node.x += dx
				node.y += dy
				box.style.left = `${node.x}px`
				box.style.top = `${node.y}px`
			}
			this.#drawWires()
		} else {
			const from = this.#center(drag.from)
			if (from !== undefined) this.#drawWires({ from, to: this.#cursor, type: drag.from.dataset['type'] ?? 'any' })
		}
	}

	readonly #onUp = (event: PointerEvent): void => {
		const drag = this.#drag
		this.#drag = undefined
		if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId)
		if (drag?.kind === 'nodes' && drag.moved) this.#onChange()
		if (drag?.kind === 'wire') {
			this.#connect(drag.from, document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.gv-dot') ?? undefined)
			this.#drawWires()
		}
	}

	readonly #onWheel = (event: WheelEvent): void => {
		event.preventDefault()
		const rect = this.element.getBoundingClientRect()
		const cx = event.clientX - rect.left
		const cy = event.clientY - rect.top
		const zoom = Math.min(2, Math.max(0.3, this.#zoom * Math.exp(-event.deltaY * 0.0012)))
		this.#pan = { x: cx - ((cx - this.#pan.x) * zoom) / this.#zoom, y: cy - ((cy - this.#pan.y) * zoom) / this.#zoom }
		this.#zoom = zoom
		this.#applyView()
	}

	readonly #onDouble = (event: MouseEvent): void => {
		const target = event.target as HTMLElement | SVGElement
		const edge = target.dataset['edge']
		if (edge !== undefined) {
			this.#edges = this.#edges.filter((_, index) => index !== Number(edge))
			this.render()
			this.#onChange()
		} else if (target === this.element || target === this.#world) this.openPicker(this.#toWorld(event.clientX, event.clientY))
	}

	readonly #onKey = (event: KeyboardEvent): void => {
		if (event.target !== this.element) return
		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault()
			this.deleteSelected()
		} else if (event.key === ' ') {
			event.preventDefault()
			this.openPicker()
		}
	}
}
