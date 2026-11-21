import { CommandRegistry, ContextKeys, KeybindingService } from '@strata/commands'
import { DisposableStore, type Disposable } from '@strata/core'
import type { EditorSession } from '@strata/editor-core'

export interface StudioHooks {
	readonly save: () => Promise<void>
	readonly close: () => void
	readonly openPalette: () => void
}

export interface Studio extends Disposable {
	readonly contexts: ContextKeys
	readonly commands: CommandRegistry
	readonly keybindings: KeybindingService
}

/**
 * Registers Studio's commands, default shortcuts and the context keys that gate them.
 */
export function createStudio(session: EditorSession, hooks: StudioHooks): Studio {
	const store = new DisposableStore()
	const contexts = new ContextKeys()
	const commands = new CommandRegistry(contexts)
	const keybindings = new KeybindingService(contexts)

	const syncContext = (): void => {
		contexts.set('hasSelection', session.selection !== undefined)
		contexts.set('isDirty', session.dirty)
		contexts.set('canUndo', session.canUndo)
		contexts.set('canRedo', session.canRedo)
	}
	syncContext()
	store.add(session.changed.subscribe(syncContext))

	store.add(commands.register({ id: 'workbench.action.showCommands', title: 'Show All Commands', category: 'View', run: hooks.openPalette }))
	store.add(commands.register({ id: 'file.save', title: 'Save', category: 'File', run: hooks.save }))
	store.add(commands.register({ id: 'project.close', title: 'Close Project', category: 'File', run: hooks.close }))
	store.add(
		commands.register({
			id: 'edit.undo',
			title: 'Undo',
			category: 'Edit',
			when: 'canUndo',
			run: () => {
				session.undo()
			}
		})
	)
	store.add(
		commands.register({
			id: 'edit.redo',
			title: 'Redo',
			category: 'Edit',
			when: 'canRedo',
			run: () => {
				session.redo()
			}
		})
	)
	store.add(
		commands.register({
			id: 'entity.add',
			title: 'Add Entity',
			category: 'Entity',
			run: () => {
				session.createEntity({})
			}
		})
	)
	store.add(
		commands.register({
			id: 'entity.addChild',
			title: 'Add Child Entity',
			category: 'Entity',
			when: 'hasSelection',
			run: () => {
				const parent = session.selection
				if (parent !== undefined) session.createEntity({ parent })
			}
		})
	)
	store.add(
		commands.register({
			id: 'entity.delete',
			title: 'Delete Selected Entity',
			category: 'Entity',
			when: 'hasSelection',
			run: () => {
				session.deleteSelected()
			}
		})
	)

	const added = keybindings.addAll([
		{ keys: 'ctrl+shift+p', command: 'workbench.action.showCommands' },
		{ keys: 'f1', command: 'workbench.action.showCommands' },
		{ keys: 'mod+s', command: 'file.save' },
		{ keys: 'mod+z', command: 'edit.undo', when: 'canUndo && !textInputFocus' },
		{ keys: 'ctrl+y', command: 'edit.redo', when: 'canRedo && !textInputFocus' },
		{ keys: 'mod+shift+z', command: 'edit.redo', when: 'canRedo && !textInputFocus' },
		{ keys: 'alt+n', command: 'entity.add' },
		{ keys: 'alt+shift+n', command: 'entity.addChild', when: 'hasSelection' }
	])
	if (!added.ok) throw added.error

	return { contexts, commands, keybindings, dispose: () => store.dispose() }
}
