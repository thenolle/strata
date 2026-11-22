export type PinType = 'flow' | 'number' | 'boolean' | 'string' | 'vec2' | 'color' | 'entity' | 'any'

export interface PinSpec {
	readonly name: string
	readonly type: PinType
	readonly default?: number | string | boolean
}

export interface GraphNode {
	readonly id: string
	readonly type: string
	readonly x: number
	readonly y: number
	/** The values typed into unconnected input pins, by pin name. */
	readonly values: Readonly<Record<string, number | string | boolean>>
}

export interface GraphEdge {
	readonly from: { readonly node: string; readonly pin: string }
	readonly to: { readonly node: string; readonly pin: string }
}

export interface GraphVariable {
	readonly name: string
	readonly type: PinType
	readonly value: number | string | boolean
}

export interface GraphData {
	readonly format: 'strata.graph'
	readonly variables: readonly GraphVariable[]
	readonly nodes: readonly GraphNode[]
	readonly edges: readonly GraphEdge[]
}

/** What a flow node can ask of the compiler while it writes its code. */
export interface FlowContext {
	readonly node: GraphNode
	/** A safe identifier for this node. */
	readonly id: string
	/** The code of a data input. */
	input(pin: string): string
	/** The statements that follow a flow output pin. */
	block(pin: string): string[]
	/** Declares a class field such as "#once_a = false". */
	field(name: string, initial: string): void
	/** The class field of the variable this node refers to. */
	variable(): string
}

export interface NodeSpec {
	readonly id: string
	readonly title: string
	readonly category: string
	readonly doc: string
	readonly inputs: readonly PinSpec[]
	readonly outputs: readonly PinSpec[]
	/** One expression per output, with {pin} placeholders for inputs. */
	readonly expr?: readonly string[]
	/** Computed once per statement that uses it, for nodes that give a different answer each time. */
	readonly impure?: boolean
	readonly needs?: 'random' | 'noise'
	readonly event?: 'onStart' | 'onUpdate'
	readonly flow?: {
		readonly emit: (context: FlowContext) => string[]
		readonly outputExpr?: (id: string, pin: string) => string
	}
}
