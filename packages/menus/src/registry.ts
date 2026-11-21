import { toDisposable, type Disposable } from '@strata/core'
import { evaluateWhen, parseWhen, type CommandRegistry, type ContextValue, type WhenNode } from '@strata/commands'

const MAX_DEPTH = 8

/**
 * A command in a menu. `group` is "name" or "name@order"; groups sort by name with "navigation" first and "default" last.
 * `when` hides the item, an unavailable command shows it disabled, and `toggled` adds a check (or radio dot) while true.
 */
export interface CommandMenuItem {
	readonly command: string
	readonly title?: string
	readonly group?: string
	readonly when?: string
	readonly toggled?: string
	readonly radio?: boolean
}

export interface SubmenuItem {
	readonly submenu: string
	readonly title: string
	readonly group?: string
	readonly when?: string
}

export type MenuItem = CommandMenuItem | SubmenuItem

export interface SeparatorEntry {
	readonly kind: 'separator'
}

export interface CommandEntry {
	readonly kind: 'command'
	readonly id: string
	readonly label: string
	readonly command: string
	readonly shortcut?: string
	readonly enabled: boolean
	readonly check: 'none' | 'check' | 'radio'
	readonly checked: boolean
}

export interface SubmenuEntry {
	readonly kind: 'submenu'
	readonly id: string
	readonly label: string
	readonly enabled: boolean
	readonly entries: readonly MenuEntry[]
}

export type MenuEntry = SeparatorEntry | CommandEntry | SubmenuEntry

export interface ResolveOptions {
	readonly commands: CommandRegistry
	readonly lookup: (name: string) => ContextValue
	readonly shortcut?: (command: string) => string | undefined
}

interface Contribution {
	readonly item: MenuItem
	readonly when: WhenNode | undefined
	readonly toggled: WhenNode | undefined
	readonly group: string
	readonly order: number
	readonly sequence: number
}

function compile(source: string | undefined): WhenNode | undefined {
	if (source === undefined) return undefined
	const parsed = parseWhen(source)
	if (!parsed.ok) throw parsed.error
	return parsed.value
}

function parseGroup(group: string | undefined): { readonly name: string; readonly order: number } {
	const [name = '', rawOrder] = (group ?? '').split('@')
	const order = rawOrder === undefined ? 0 : Number(rawOrder)
	return { name: name === '' ? 'default' : name, order: Number.isFinite(order) ? order : 0 }
}

function groupKey(name: string): string {
	return name === 'navigation' ? '\u0000' : name === 'default' ? '\uffff' : name
}

/**
 * Collects menu contributions from any part of the application and resolves them against the current context.
 */
export class MenuRegistry {
	readonly #menus = new Map<string, Contribution[]>()
	#sequence = 0

	add(menuId: string, item: MenuItem): Disposable {
		const { name, order } = parseGroup(item.group)
		const contribution: Contribution = {
			item,
			when: compile(item.when),
			toggled: 'command' in item ? compile(item.toggled) : undefined,
			group: name,
			order,
			sequence: this.#sequence++
		}
		const list = this.#menus.get(menuId) ?? []
		list.push(contribution)
		this.#menus.set(menuId, list)
		return toDisposable(() => {
			const index = list.indexOf(contribution)
			if (index >= 0) list.splice(index, 1)
		})
	}

	has(menuId: string): boolean {
		return (this.#menus.get(menuId)?.length ?? 0) > 0
	}

	/**
	 * The visible entries of a menu in display order, with separators between groups.
	 */
	resolve(menuId: string, options: ResolveOptions): MenuEntry[] {
		return this.#resolve(menuId, options, [])
	}

	#resolve(menuId: string, options: ResolveOptions, trail: readonly string[]): MenuEntry[] {
		if (trail.includes(menuId) || trail.length >= MAX_DEPTH) return []
		const resolved: { readonly contribution: Contribution; readonly entry: CommandEntry | SubmenuEntry }[] = []
		for (const contribution of this.#menus.get(menuId) ?? []) {
			if (contribution.when !== undefined && !evaluateWhen(contribution.when, options.lookup)) continue
			const item = contribution.item
			const id = `${menuId}#${contribution.sequence}`
			if ('command' in item) {
				const definition = options.commands.get(item.command)
				if (definition === undefined) continue
				const shortcut = options.shortcut?.(item.command)
				resolved.push({
					contribution,
					entry: {
						kind: 'command',
						id,
						label: item.title ?? definition.title,
						command: item.command,
						...(shortcut === undefined ? {} : { shortcut }),
						enabled: options.commands.isEnabled(item.command, options.lookup),
						check: contribution.toggled === undefined ? 'none' : item.radio === true ? 'radio' : 'check',
						checked: contribution.toggled !== undefined && evaluateWhen(contribution.toggled, options.lookup)
					}
				})
			} else {
				const entries = this.#resolve(item.submenu, options, [...trail, menuId])
				if (entries.length === 0) continue
				resolved.push({
					contribution,
					entry: { kind: 'submenu', id, label: item.title, enabled: entries.some((entry) => entry.kind !== 'separator' && entry.enabled), entries }
				})
			}
		}
		resolved.sort((a, b) => {
			const left = groupKey(a.contribution.group)
			const right = groupKey(b.contribution.group)
			if (left !== right) return left < right ? -1 : 1
			return a.contribution.order - b.contribution.order || a.contribution.sequence - b.contribution.sequence
		})
		const entries: MenuEntry[] = []
		let previousGroup: string | undefined
		for (const { contribution, entry } of resolved) {
			if (previousGroup !== undefined && previousGroup !== contribution.group) entries.push({ kind: 'separator' })
			entries.push(entry)
			previousGroup = contribution.group
		}
		return entries
	}
}
