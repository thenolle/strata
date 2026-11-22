export type ComponentView = { [field: string]: number | string | boolean }

export interface InputView {
	isDown(code: string): boolean
	wasPressed(code: string): boolean
	/** Positive minus negative, each 0 or 1 for keys. */
	axis(negative: string, positive: string): number
}

export interface ScriptContext {
	/** The entity this script is attached to. */
	readonly entity: number
	readonly name: string
	/** Length of the current fixed step in seconds. */
	readonly dt: number
	/** Seconds since the game started. */
	readonly time: number
	readonly input: InputView
	/** The live data of one of this entity's components, such as "transform" or "body". Undefined when it has none. */
	get(component: string): ComponentView | undefined
	has(component: string): boolean
	/** Finds another entity by name. */
	find(name: string): number | undefined
	getOf(entity: number, component: string): ComponentView | undefined
	setPosition(x: number, y: number): void
	log(...values: unknown[]): void
}

export interface Script {
	onStart?(ctx: ScriptContext): void
	onUpdate?(ctx: ScriptContext): void
}
