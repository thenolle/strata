import { CommandRegistry, ContextKeys, KeybindingService } from '@strata/commands'
import { DisposableStore, type Disposable } from '@strata/core'
import type { EditorSession } from '@strata/editor-core'
import { MenuRegistry } from '@strata/menus'

export interface StudioHooks {
	readonly save: () => Promise<void>
	readonly close: () => void
	readonly openPalette: () => void
	readonly openContextMenu: () => void
}

export interface Studio extends Disposable {
	readonly contexts: ContextKeys
	readonly commands: CommandRegistry
	readonly keybindings: KeybindingService
	readonly menus: MenuRegistry
}

/**
 * Registers Studio's commands, default shortcuts, menus and the context keys that gate them.
 */
export function createStudio(session: EditorSession, hooks: StudioHooks): Studio {
	const store = new DisposableStore()
	const contexts = new ContextKeys()
	const commands = new CommandRegistry(contexts)
	const keybindings = new KeybindingService(contexts)
	const menus = new MenuRegistry()

	const syncContext = (): void => {
		contexts.set('hasSelection', session.selection !== undefined)
		contexts.set('isDirty', session.dirty)
		contexts.set('canUndo', session.canUndo)
		contexts.set('canRedo', session.canRedo)
	}
	syncContext()
	store.add(session.changed.subscribe(syncContext))

	const command = (id: string, title: string, category: string, run: () => void | Promise<void>, when?: string): void => {
		store.add(commands.register({ id, title, category, ...(when === undefined ? {} : { when }), run }))
	}
	command('workbench.action.showCommands', 'Show All Commands', 'View', hooks.openPalette)
	command('workbench.action.showContextMenu', 'Show Context Menu', 'View', hooks.openContextMenu)
	command('file.save', 'Save', 'File', hooks.save)
	command('project.close', 'Close Project', 'File', hooks.close)
	command('edit.undo', 'Undo', 'Edit', () => void session.undo(), 'canUndo')
	command('edit.redo', 'Redo', 'Edit', () => void session.redo(), 'canRedo')
	command('entity.add', 'Add Entity', 'Entity', () => void session.createEntity({}))
	command(
		'entity.addChild',
		'Add Child Entity',
		'Entity',
		() => {
			const parent = session.selection
			if (parent !== undefined) session.createEntity({ parent })
		},
		'hasSelection'
	)
	command(
		'entity.rename',
		'Rename Selected Entity',
		'Entity',
		() => {
			const input = document.querySelector<HTMLInputElement>('.inspector input[type="text"]')
			input?.focus()
			input?.select()
		},
		'hasSelection'
	)
	command('entity.delete', 'Delete Selected Entity', 'Entity', () => void session.deleteSelected(), 'hasSelection')

	const added = keybindings.addAll([
		{ keys: 'ctrl+shift+p', command: 'workbench.action.showCommands' },
		{ keys: 'f1', command: 'workbench.action.showCommands' },
		{ keys: 'shift+f10', command: 'workbench.action.showContextMenu' },
		{ keys: 'contextmenu', command: 'workbench.action.showContextMenu' },
		{ keys: 'mod+s', command: 'file.save' },
		{ keys: 'mod+z', command: 'edit.undo', when: 'canUndo && !textInputFocus' },
		{ keys: 'ctrl+y', command: 'edit.redo', when: 'canRedo && !textInputFocus' },
		{ keys: 'mod+shift+z', command: 'edit.redo', when: 'canRedo && !textInputFocus' },
		{ keys: 'f2', command: 'entity.rename', when: 'hasSelection && !textInputFocus' },
		{ keys: 'alt+n', command: 'entity.add' },
		{ keys: 'alt+shift+n', command: 'entity.addChild', when: 'hasSelection' }
	])
	if (!added.ok) throw added.error

	const contribute = (menu: string, item: Parameters<MenuRegistry['add']>[1]): void => {
		store.add(menus.add(menu, item))
	}
	contribute('outline/context', { submenu: 'entity/create', title: 'Create', group: '1_create' })
	contribute('entity/create', { command: 'entity.add', title: 'Entity', group: '1_create@1' })
	contribute('entity/create', { command: 'entity.addChild', title: 'Child Entity', group: '1_create@2' })
	contribute('outline/context', { command: 'entity.rename', group: '2_modify@1' })
	contribute('outline/context', { command: 'entity.delete', group: '2_modify@2' })
	contribute('outline/context', { command: 'edit.undo', group: '3_history@1' })
	contribute('outline/context', { command: 'edit.redo', group: '3_history@2' })
	contribute('outline/context', { command: 'workbench.action.showCommands', group: '9_misc' })

	return { contexts, commands, keybindings, menus, dispose: () => store.dispose() }
}
