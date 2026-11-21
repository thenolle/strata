/** @jsxImportSource @gambrel/view */
import { effect, onCleanup, signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import { MenuController, type ActivateResult, type MenuEntry } from '@strata/menus'
import type { Studio } from './studio.ts'

const OPEN_DELAY_MS = 220
const CLOSE_DELAY_MS = 160
const MARGIN = 8

export interface MenuRequest {
	readonly menuId: string
	readonly x: number
	readonly y: number
	readonly args?: unknown
	readonly keyboard?: boolean
}

interface Environment {
	readonly x: number
	readonly y: number
	readonly active: () => readonly number[]
	readonly parentOf: (level: number) => number
	readonly hover: (level: number, index: number) => void
	readonly press: (level: number, index: number) => void
}

function roleOf(entry: MenuEntry): string {
	if (entry.kind !== 'command' || entry.check === 'none') return 'menuitem'
	return entry.check === 'radio' ? 'menuitemradio' : 'menuitemcheckbox'
}

function MenuList(props: { readonly level: number; readonly entries: readonly MenuEntry[]; readonly env: Environment }): Child {
	const { level, entries, env } = props
	const parentIndex = level === 0 ? -1 : env.parentOf(level)
	return (
		<ul
			class="menu"
			role="menu"
			style="visibility:hidden"
			ref={(element: Element) => {
				const list = element as HTMLElement
				requestAnimationFrame(() => {
					const rect = list.getBoundingClientRect()
					const anchor = level === 0 ? undefined : document.getElementById(`menu-item-${level - 1}-${parentIndex}`)?.getBoundingClientRect()
					let left = env.x
					let top = env.y
					if (anchor !== undefined) {
						left = anchor.right - 2
						top = anchor.top - 4
						if (left + rect.width > innerWidth - MARGIN) left = anchor.left - rect.width + 2
					}
					if (top + rect.height > innerHeight - MARGIN) {
						top = anchor === undefined && env.y - rect.height >= MARGIN ? env.y - rect.height : Math.max(MARGIN, innerHeight - MARGIN - rect.height)
					}
					left = Math.max(MARGIN, Math.min(left, innerWidth - MARGIN - rect.width))
					list.style.left = `${left}px`
					list.style.top = `${top}px`
					list.style.maxHeight = `${innerHeight - 2 * MARGIN}px`
					list.style.visibility = 'visible'
				})
			}}
		>
			{entries.map((entry, index) =>
				entry.kind === 'separator' ? (
					<li class="menu-separator" role="separator"></li>
				) : (
					<li
						class="menu-item"
						id={`menu-item-${level}-${index}`}
						role={roleOf(entry)}
						aria-disabled={entry.enabled ? null : 'true'}
						aria-haspopup={entry.kind === 'submenu' ? 'menu' : null}
						aria-checked={entry.kind === 'command' && entry.check !== 'none' ? String(entry.checked) : null}
						ref={(element: Element) => {
							effect(() => {
								element.setAttribute('data-active', String(env.active()[level] === index))
							})
						}}
						onPointerEnter={() => env.hover(level, index)}
						onClick={() => env.press(level, index)}
					>
						<span class="menu-check">{entry.kind === 'command' && entry.check !== 'none' && entry.checked ? (entry.check === 'radio' ? '●' : '✓') : ''}</span>
						<span class="menu-label">{entry.label}</span>
						<span class="menu-shortcut">{entry.kind === 'command' ? (entry.shortcut ?? '') : ''}</span>
						<span class="menu-chevron">{entry.kind === 'submenu' ? '›' : ''}</span>
					</li>
				)
			)}
		</ul>
	)
}

/**
 * A context menu with nested submenus, keyboard navigation, type-ahead and viewport-aware placement.
 * Each opening creates a fresh instance; the owner removes it from the page when `onClose` is called.
 */
export function ContextMenu(props: {
	readonly request: MenuRequest
	readonly studio: Studio
	readonly onRun: (command: string, args: unknown) => void
	readonly onClose: () => void
}): Child {
	const { request, studio } = props
	const entries = studio.menus.resolve(request.menuId, {
		commands: studio.commands,
		lookup: (name) => studio.contexts.get(name),
		shortcut: (command) => studio.keybindings.labelFor(command)
	})
	if (entries.length === 0) {
		queueMicrotask(props.onClose)
		return <div></div>
	}
	const controller = new MenuController()
	controller.open(entries, { activateFirst: request.keyboard === true })
	const submenus = signal<readonly (readonly MenuEntry[])[]>([])
	const active = signal<readonly number[]>(controller.levels.map((level) => level.active))
	let openTimer: ReturnType<typeof setTimeout> | undefined
	let closeTimer: ReturnType<typeof setTimeout> | undefined

	const sync = (): void => {
		const levels = controller.levels
		const nested = levels.slice(1).map((level) => level.entries)
		const current = submenus.peek()
		if (nested.length !== current.length || nested.some((list, index) => list !== current[index])) submenus.set(nested)
		active.set(levels.map((level) => level.active))
	}

	const cancelTimers = (): void => {
		clearTimeout(openTimer)
		clearTimeout(closeTimer)
		openTimer = undefined
		closeTimer = undefined
	}

	const finish = (result: ActivateResult): void => {
		if (result.kind === 'run') {
			props.onClose()
			props.onRun(result.entry.command, request.args)
			return
		}
		sync()
	}

	const apply = (level: number, index: number): void => {
		controller.hover(level, index)
		sync()
		const entry = controller.levels[level]?.entries[index]
		if (entry?.kind === 'submenu' && entry.enabled && controller.levels.length === level + 1) {
			openTimer = setTimeout(() => {
				const levels = controller.levels
				if (levels.length === level + 1 && levels[level]?.active === index && controller.openSubmenu({ activateFirst: false })) sync()
			}, OPEN_DELAY_MS)
		}
	}

	const hover = (level: number, index: number): void => {
		cancelTimers()
		const levels = controller.levels
		if (level < levels.length - 1 && levels[level]?.active !== index) {
			closeTimer = setTimeout(() => apply(level, index), CLOSE_DELAY_MS)
			return
		}
		apply(level, index)
	}

	const env: Environment = {
		x: request.x,
		y: request.y,
		active,
		parentOf: (level) => controller.levels[level - 1]?.active ?? -1,
		hover,
		press: (level, index) => {
			cancelTimers()
			finish(controller.activateAt(level, index))
		}
	}

	const onKeyDown = (event: KeyboardEvent): void => {
		cancelTimers()
		switch (event.key) {
			case 'ArrowDown':
				controller.move(1)
				break
			case 'ArrowUp':
				controller.move(-1)
				break
			case 'Home':
				controller.first()
				break
			case 'End':
				controller.last()
				break
			case 'ArrowRight':
				controller.openSubmenu()
				break
			case 'ArrowLeft':
				controller.closeSubmenu()
				break
			case 'Enter':
			case ' ':
				finish(controller.activate())
				break
			case 'Escape':
				if (!controller.closeSubmenu()) props.onClose()
				break
			case 'Tab':
				props.onClose()
				break
			default:
				if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
				controller.typeahead(event.key)
		}
		event.preventDefault()
		event.stopPropagation()
		sync()
	}

	return (
		<div
			class="menu-root"
			tabindex="-1"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) props.onClose()
			}}
			onContextMenu={(event) => {
				event.preventDefault()
				if (event.target === event.currentTarget) props.onClose()
			}}
			ref={(element: Element) => {
				const root = element as HTMLElement
				const previous = document.activeElement
				requestAnimationFrame(() => root.focus({ preventScroll: true }))
				const close = (): void => props.onClose()
				root.addEventListener('keydown', onKeyDown)
				addEventListener('blur', close)
				addEventListener('resize', close)
				effect(() => {
					const levels = active()
					const level = levels.length - 1
					const index = levels[level] ?? -1
					if (index >= 0) root.setAttribute('aria-activedescendant', `menu-item-${level}-${index}`)
					else root.removeAttribute('aria-activedescendant')
				})
				onCleanup(() => {
					cancelTimers()
					root.removeEventListener('keydown', onKeyDown)
					removeEventListener('blur', close)
					removeEventListener('resize', close)
					if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
				})
			}}
		>
			<MenuList level={0} entries={entries} env={env} />
			{() => submenus().map((list, offset) => <MenuList level={offset + 1} entries={list} env={env} />)}
		</div>
	)
}
