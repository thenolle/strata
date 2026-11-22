import { CommandRegistry, ContextKeys, KeybindingService } from '@strata/commands'
import { DisposableStore, type Disposable, type Guid } from '@strata/core'
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

function assetArg(args: unknown): string | undefined {
	if (typeof args !== 'object' || args === null) return undefined
	const asset = (args as { readonly asset?: unknown }).asset
	return typeof asset === 'string' ? asset : undefined
}

function worldPoint(args: unknown): { readonly x: number; readonly y: number } | undefined {
	if (typeof args !== 'object' || args === null) return undefined
	const world = (args as { readonly world?: unknown }).world
	if (typeof world !== 'object' || world === null) return undefined
	const { x, y } = world as { readonly x?: unknown; readonly y?: unknown }
	if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return undefined
	return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }
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

	contexts.set('gridVisible', true)
	const syncContext = (): void => {
		contexts.set('hasSelection', session.selection !== undefined)
		contexts.set('isDirty', session.dirty)
		contexts.set('canUndo', session.canUndo)
		contexts.set('canRedo', session.canRedo)
	}
	syncContext()
	store.add(session.changed.subscribe(syncContext))

	// Commands

	const command = (id: string, title: string, category: string, run: (args?: unknown) => void | Promise<void>, when?: string): void => { store.add(commands.register({ id, title, category, ...(when === undefined ? {} : { when }), run })) }

	command('workbench.action.showCommands', 'Show All Commands', 'View', hooks.openPalette)
	command('workbench.action.showContextMenu', 'Show Context Menu', 'View', hooks.openContextMenu)
	command('view.toggleGrid', 'Toggle Grid', 'View', () => contexts.set('gridVisible', contexts.get('gridVisible') !== true))
	command('file.save', 'Save', 'File', hooks.save)
	command('project.close', 'Close Project', 'File', hooks.close)
	command('edit.undo', 'Undo', 'Edit', () => void session.undo(), 'canUndo')
	command('edit.redo', 'Redo', 'Edit', () => void session.redo(), 'canRedo')
	command('entity.add', 'Add Entity', 'Entity', () => void session.createEntity({}))
	command('entity.addAt', 'Add Entity Here', 'Entity', (args) => void session.createEntity(worldPoint(args) ?? {}))
	command('entity.addChild', 'Add Child Entity', 'Entity', () => {
		const parent = session.selection
		if (parent !== undefined) session.createEntity({ parent })
	}, 'hasSelection')
	command('entity.rename', 'Rename Selected Entity', 'Entity', () => {
		const input = document.querySelector<HTMLInputElement>('.inspector input[type="text"]')
		input?.focus()
		input?.select()
	}, 'hasSelection')
	command('entity.delete', 'Delete Selected Entity', 'Entity', () => void session.deleteSelected(), 'hasSelection')
	command('entity.duplicate', 'Duplicate Selected Entity', 'Entity', () => {
		const selected = session.selection
		if (selected !== undefined) session.duplicate(selected)
	}, 'hasSelection')
	const imageAsset = (args: unknown): { readonly id: Guid; readonly name: string } => {
		const id = assetArg(args)
		const record = id === undefined ? undefined : session.project.assets.get(id as Guid)
		if (record === undefined) throw new Error('Choose an asset in the Assets panel first')
		if (record.kind !== 'image') throw new Error('Only images can be used as sprites')
		return { id: record.id, name: record.name }
	}
	command('asset.addToScene', 'Add Asset to Scene', 'Asset', (args) => {
		const asset = imageAsset(args)
		session.createEntity({ name: asset.name.replace(/\.[^.]+$/, ''), asset: asset.id, ...(worldPoint(args) ?? {}) })
	})
	command('asset.assignToSelection', 'Assign Asset to Selected Entity', 'Asset', (args) => {
		const asset = imageAsset(args)
		const selected = session.selection
		if (selected !== undefined) session.setSprite(selected, asset.id)
	}, 'hasSelection')

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
		{ keys: 'alt+shift+n', command: 'entity.addChild', when: 'hasSelection' },
		{ keys: 'mod+d', command: 'entity.duplicate', when: 'hasSelection && !textInputFocus' },
	])
	if (!added.ok) throw added.error

	// Contibutions

	const contribute = (menu: string, item: Parameters<MenuRegistry['add']>[1]): void => { store.add(menus.add(menu, item)) }

	contribute('entity/create', { command: 'entity.add', title: 'Entity', group: '1_create@1' })
	contribute('entity/create', { command: 'entity.addChild', title: 'Child Entity', group: '1_create@2' })

	contribute('outline/context', { submenu: 'entity/create', title: 'Create', group: '1_create' })
	contribute('outline/context', { command: 'entity.rename', group: '2_modify@1' })
	contribute('outline/context', { command: 'entity.delete', group: '2_modify@2' })
	contribute('outline/context', { command: 'edit.undo', group: '3_history@1' })
	contribute('outline/context', { command: 'edit.redo', group: '3_history@2' })
	contribute('outline/context', { command: 'workbench.action.showCommands', group: '9_misc' })
	contribute('outline/context', { command: 'entity.duplicate', group: '2_modify@0' })

	contribute('viewport/context', { command: 'entity.addAt', group: '1_create@1' })
	contribute('viewport/context', { command: 'entity.addChild', group: '1_create@2', when: 'hasSelection' })
	contribute('viewport/context', { command: 'entity.rename', group: '2_modify@1', when: 'hasSelection' })
	contribute('viewport/context', { command: 'entity.delete', group: '2_modify@2', when: 'hasSelection' })
	contribute('viewport/context', { command: 'edit.undo', group: '3_history@1' })
	contribute('viewport/context', { command: 'edit.redo', group: '3_history@2' })
	contribute('viewport/context', { command: 'view.toggleGrid', title: 'Show Grid', group: '4_view', toggled: 'gridVisible' })
	contribute('viewport/context', { command: 'workbench.action.showCommands', group: '9_misc' })
	contribute('viewport/context', { command: 'entity.duplicate', group: '2_modify@0', when: 'hasSelection' })

	contribute('assets/context', { command: 'asset.addToScene', group: '1_create' })
	contribute('assets/context', { command: 'asset.assignToSelection', group: '2_modify' })

	return { contexts, commands, keybindings, menus, dispose: () => store.dispose() }
}
