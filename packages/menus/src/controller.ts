import type { CommandEntry, MenuEntry } from './registry.ts'

export interface MenuLevel {
	readonly entries: readonly MenuEntry[]
	/**
	 * Index of the highlighted entry, or -1 for none.
	 */
	readonly active: number
}

export type ActivateResult =
	| { readonly kind: 'run'; readonly entry: CommandEntry }
	| { readonly kind: 'opened' }
	| { readonly kind: 'none' }

export interface ControllerOptions {
	readonly now?: () => number
	readonly typeaheadMs?: number
}

interface Level {
	entries: readonly MenuEntry[]
	active: number
	readonly parentIndex: number
}

function selectable(entry: MenuEntry | undefined): boolean {
	return entry !== undefined && entry.kind !== 'separator' && entry.enabled
}

/**
 * Keyboard and pointer behaviour of an open menu and its submenus, independent of any rendering.
 */
export class MenuController {
	readonly #now: () => number
	readonly #typeaheadMs: number
	#levels: Level[] = []
	#typed = ''
	#typedAt = 0

	constructor(options: ControllerOptions = {}) {
		this.#now = options.now ?? Date.now
		this.#typeaheadMs = options.typeaheadMs ?? 700
	}

	get isOpen(): boolean {
		return this.#levels.length > 0
	}

	get levels(): readonly MenuLevel[] {
		return this.#levels.map((level) => ({ entries: level.entries, active: level.active }))
	}

	open(entries: readonly MenuEntry[], options: { readonly activateFirst?: boolean } = {}): void {
		this.#levels = [{ entries, active: options.activateFirst === true ? this.#step(entries, -1, 1) : -1, parentIndex: -1 }]
		this.#typed = ''
	}

	close(): void {
		this.#levels = []
	}

	move(delta: 1 | -1): void {
		const level = this.#deepest()
		if (level !== undefined) level.active = this.#step(level.entries, level.active, delta)
	}

	first(): void {
		const level = this.#deepest()
		if (level !== undefined) level.active = this.#step(level.entries, -1, 1)
	}

	last(): void {
		const level = this.#deepest()
		if (level !== undefined) level.active = this.#step(level.entries, 0, -1)
	}

	/**
	 * Highlights an entry. Submenus that belong to a different entry close.
	 */
	hover(levelIndex: number, index: number): void {
		const level = this.#levels[levelIndex]
		const entry = level?.entries[index]
		if (level === undefined || entry === undefined || entry.kind === 'separator') return
		const child = this.#levels[levelIndex + 1]
		if (child !== undefined && child.parentIndex !== index) this.#levels.length = levelIndex + 1
		level.active = index
	}

	/**
	 * Opens the submenu of the highlighted entry. Returns false when the entry has none or is disabled.
	 */
	openSubmenu(options: { readonly activateFirst?: boolean } = {}): boolean {
		const level = this.#deepest()
		const entry = level?.entries[level.active]
		if (level === undefined || entry === undefined || entry.kind !== 'submenu' || !entry.enabled) return false
		this.#levels.push({
			entries: entry.entries,
			active: options.activateFirst === false ? -1 : this.#step(entry.entries, -1, 1),
			parentIndex: level.active
		})
		return true
	}

	closeSubmenu(): boolean {
		if (this.#levels.length <= 1) return false
		this.#levels.pop()
		return true
	}

	activate(): ActivateResult {
		const level = this.#deepest()
		const entry = level?.entries[level.active]
		if (entry === undefined || entry.kind === 'separator' || !entry.enabled) return { kind: 'none' }
		if (entry.kind === 'command') return { kind: 'run', entry }
		return this.openSubmenu() ? { kind: 'opened' } : { kind: 'none' }
	}

	/**
	 * Activates a specific entry, as a click does. Submenus deeper than that level close first.
	 */
	activateAt(levelIndex: number, index: number): ActivateResult {
		const level = this.#levels[levelIndex]
		if (level === undefined) return { kind: 'none' }
		this.#levels.length = levelIndex + 1
		level.active = index
		return this.activate()
	}

	/**
	 * Jumps to the next entry whose label starts with the typed text. Typing the same letter repeatedly cycles.
	 */
	typeahead(character: string): boolean {
		const level = this.#deepest()
		if (level === undefined) return false
		const now = this.#now()
		if (now - this.#typedAt > this.#typeaheadMs) this.#typed = ''
		this.#typedAt = now
		this.#typed += character.toLowerCase()
		const count = level.entries.length
		const start = this.#typed.length === 1 ? level.active : level.active - 1
		for (let offset = 1; offset <= count; offset++) {
			const index = (((start + offset) % count) + count) % count
			const entry = level.entries[index]
			if (entry !== undefined && entry.kind !== 'separator' && selectable(entry) && entry.label.toLowerCase().startsWith(this.#typed)) {
				level.active = index
				return true
			}
		}
		return false
	}

	#deepest(): Level | undefined {
		return this.#levels[this.#levels.length - 1]
	}

	#step(entries: readonly MenuEntry[], from: number, direction: 1 | -1): number {
		const count = entries.length
		const start = from < 0 && direction < 0 ? 0 : from
		for (let offset = 1; offset <= count; offset++) {
			const index = (((start + direction * offset) % count) + count) % count
			if (selectable(entries[index])) return index
		}
		return -1
	}
}
