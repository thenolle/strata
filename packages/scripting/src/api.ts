/**
 * The data of one component, with every field readable and writable. Changes apply immediately.
 */
export type ComponentView = { [field: string]: number | string | boolean }

/**
 * Keyboard input. Codes are physical key names such as "ArrowLeft", "KeyA", "Space" or "Enter".
 */
export interface InputView {
	/** True while the key is held down. */
	isDown(code: string): boolean
	/** True during the frame the key was pressed. */
	wasPressed(code: string): boolean
	/** Returns 1 when only the positive key is held, -1 when only the negative key is, and 0 otherwise. */
	axis(negative: string, positive: string): number
}

/**
 * Everything a script can see and do. It is passed to every hook.
 */
export interface ScriptContext {
	/** The entity this script is attached to. */
	readonly entity: number
	/** The name of this entity, as shown in the hierarchy. */
	readonly name: string
	/** Length of the current fixed step in seconds. Multiply speeds by it to move at the same rate on every machine. */
	readonly dt: number
	/** Seconds since the game started. */
	readonly time: number
	readonly input: InputView
	/**
	 * The live data of one of this entity's components, such as "transform", "body" or "sprite".
	 * Returns undefined when the entity does not have it.
	 */
	get(component: string): ComponentView | undefined
	/** True when this entity has the named component. */
	has(component: string): boolean
	/** Finds another entity by its name and returns its id, or undefined when there is none. */
	find(name: string): number | undefined
	/** Like get, but for another entity found with find. */
	getOf(entity: number, component: string): ComponentView | undefined
	/** Moves this entity to a position, in the units of its parent (the world for top-level entities). */
	setPosition(x: number, y: number): void
	/** Prints a line in the log shown while playing. */
	log(...values: unknown[]): void
}

/**
 * A script is a class with any of these methods. One instance is created for each entity it is attached to.
 */
export interface Script {
	/** Called once, before the first update. */
	onStart?(ctx: ScriptContext): void
	/** Called on every fixed step while the game runs. */
	onUpdate?(ctx: ScriptContext): void
}
