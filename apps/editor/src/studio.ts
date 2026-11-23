import { CommandRegistry, ContextKeys, KeybindingService } from '@strata/commands'
import { DisposableStore, type Disposable, type Entity, type Guid } from '@strata/core'
import type { EditorSession } from '@strata/editor-core'
import { MenuRegistry } from '@strata/menus'
import SCRIPT_TEMPLATE from './ide/script-template.txt'
import { emptyGraphText } from './graph-view.ts'
import { dialogs } from './dialogs.tsx'

export interface StudioHooks {
	readonly save: () => Promise<void>
	readonly close: () => void
	readonly openPalette: () => void
	readonly openContextMenu: () => void
	readonly play: () => void
	readonly openScript: (asset: Guid) => void
	readonly revealFolder: (path: string) => void
	readonly openGraph: (asset: Guid) => void
	readonly openExport: () => void
	readonly announce: (text: string) => void
	readonly openControls: () => void
	readonly resetLayout: () => void
}

export interface Studio extends Disposable {
	readonly contexts: ContextKeys
	readonly commands: CommandRegistry
	readonly keybindings: KeybindingService
	readonly menus: MenuRegistry
}

function folderArg(args: unknown): string | undefined {
	if (typeof args !== 'object' || args === null) return undefined
	const folder = (args as { readonly folder?: unknown }).folder
	return typeof folder === 'string' ? folder : undefined
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
		contexts.set('multiSelection', session.selected.length > 1)
		contexts.set('isDirty', session.dirty)
		contexts.set('canUndo', session.canUndo)
		contexts.set('canRedo', session.canRedo)
	}
	syncContext()
	store.add(session.changed.subscribe(syncContext))

	let clipboard: string | undefined
	contexts.set('tool', 'move')
	contexts.set('hasClipboard', false)
	const copySelection = (): boolean => {
		const entity = session.selection
		const text = entity === undefined ? undefined : session.copyEntity(entity)
		if (text === undefined) return false
		clipboard = text
		contexts.set('hasClipboard', true)
		void navigator.clipboard?.writeText(text).catch(() => undefined)
		return true
	}

	const imageAsset = (args: unknown): { readonly id: Guid; readonly name: string } => {
		const id = assetArg(args)
		const record = id === undefined ? undefined : session.project.assets.get(id as Guid)
		if (record === undefined) throw new Error('Choose an asset in the Assets panel first')
		if (record.kind !== 'image') throw new Error('Only images can be used as sprites')
		return { id: record.id, name: record.name }
	}

	const colliderSize = (entity: Entity): { readonly width: number; readonly height: number } => {
		const asset = session.spriteOf(entity)
		const record = asset === '' ? undefined : session.project.assets.get(asset as Guid)
		return record?.kind === 'image' ? { width: record.image.width, height: record.image.height } : { width: 32, height: 32 }
	}

	const assetOf = (args: unknown) => {
		const id = assetArg(args)
		const record = id === undefined ? undefined : session.project.assets.get(id as Guid)
		if (record === undefined) throw new Error('Choose a file in the Explorer first')
		return record
	}
	const fail = (message: string): never => {
		throw new Error(message)
	}

	const isFile = "assetKind != 'folder' && assetKind != ''"
	const isFolder = "assetKind == 'folder' || assetKind == ''"

	const sceneArg = (args: unknown): string | undefined => {
		if (typeof args !== 'object' || args === null) return undefined
		const name = (args as { readonly name?: unknown }).name
		return typeof name === 'string' ? name : undefined
	}
	const leaveScene = async (): Promise<boolean> => {
		if (!session.dirty) return true
		const choice = await dialogs.choose<'save' | 'discard'>(`"${session.scene}" has unsaved changes.`, [{ label: 'Save and continue', value: 'save' }, { label: 'Discard the changes', value: 'discard' }], { title: 'Unsaved changes' })
		if (choice === 'save') {
			await hooks.save()
			return !session.dirty
		}
		return choice === 'discard'
	}
	const instantiatePrefab = async (args: unknown): Promise<void> => {
		const record = assetOf(args)
		if (record.kind !== 'prefab') return fail('Choose a prefab in the Explorer first')
		const bytes = await session.project.assets.read(record.id)
		if (!bytes.ok) return fail(bytes.error.message)
		const point = worldPoint(args)
		if (session.paste(new TextDecoder().decode(bytes.value), { ...(point === undefined ? {} : { at: point }), label: false }) === undefined) fail('The prefab is damaged')
	}

	// Commands

	const command = (id: string, title: string, category: string, run: (args?: unknown) => void | Promise<void>, when?: string): void => { store.add(commands.register({ id, title, category, ...(when === undefined ? {} : { when }), run })) }

	command('workbench.action.showCommands', 'Show All Commands', 'View', hooks.openPalette)
	command('workbench.action.showContextMenu', 'Show Context Menu', 'View', hooks.openContextMenu)

	command('file.save', 'Save', 'File', hooks.save)

	command('help.about', 'About Strata', 'Help', async () => { await dialogs.alert('Strata is a 2D and 3D game development environment by Nolly.\n\nGames made with Strata belong to their creators, with credit to Nolly and Strata.', { title: 'About Strata' }) })

	command('project.close', 'Close Project', 'File', hooks.close)

	command('view.toggleGrid', 'Toggle Grid', 'View', () => contexts.set('gridVisible', contexts.get('gridVisible') !== true))
	command('view.mode2d', 'Switch to 2D View', 'View', () => contexts.set('viewMode', '2d'))
	command('view.mode3d', 'Switch to 3D View', 'View', () => contexts.set('viewMode', '3d'))
	command('view.resetLayout', 'Reset Layout', 'View', () => hooks.resetLayout())

	command('asset.addToScene', 'Add Asset to Scene', 'Asset', async (args) => {
		if (session.project.assets.get(assetArg(args) as Guid)?.kind === 'prefab') return instantiatePrefab(args)
		const asset = imageAsset(args)
		session.createEntity({ name: asset.name.replace(/\.[^.]+$/, ''), asset: asset.id, ...(worldPoint(args) ?? {}) })
	})
	command('asset.assignToSelection', 'Assign Asset to Selected Entity', 'Asset', (args) => {
		const asset = imageAsset(args)
		const selected = session.selection
		if (selected !== undefined) session.setSprite(selected, asset.id)
	}, 'hasSelection')
	command('asset.delete', 'Delete Asset', 'Asset', async (args) => {
		const asset = assetOf(args)
		const uses = session.assetUsage(asset.id)
		const warning = uses > 0 ? `\n\nIt is used by ${uses} component${uses === 1 ? '' : 's'} in the scene, which will lose it.` : ''
		if (!(await dialogs.confirm(`Delete "${asset.name}"?${warning}`, { title: 'Delete file', okLabel: 'Delete', danger: true }))) return
		const result = await session.project.assets.remove(asset.id)
		if (!result.ok) return fail(result.error.message)
		session.notifyAssetsChanged()
	})
	command('asset.rename', 'Rename Asset', 'Asset', async (args) => {
		const asset = assetOf(args)
		const name = await dialogs.prompt('New name', { title: 'Rename file', value: asset.name })
		if (!name) return
		if (name === null || name.trim() === asset.name) return
		const result = await session.project.assets.rename(asset.id, name)
		if (!result.ok) return fail(result.error.message)
		session.notifyAssetsChanged()
	})
	command('asset.move', 'Move Asset to Folder', 'Asset', async (args) => {
		const asset = assetOf(args)
		const folder = folderArg(args) ?? ''
		if (folder === asset.folder) return
		const result = await session.project.assets.move(asset.id, folder)
		if (!result.ok) return fail(result.error.message)
		hooks.revealFolder(folder)
		session.notifyAssetsChanged()
	})

	command('play.start', 'Play Scene', 'Game', hooks.play)

	command('entity.addPlayer', 'Add Player', 'Entity', () => void session.createEntity({ name: 'Player', y: 120, components: { body: {}, collider: {}, controller: {} } }))
	command('entity.addPlatform', 'Add Platform', 'Entity', () => void session.createEntity({ name: 'Platform', y: -100, components: { body: { kind: 'static' }, collider: { width: 256, height: 32 } } }))
	command('entity.addCamera', 'Add Camera', 'Entity', () => void session.createEntity({ name: 'Camera', components: { camera: {} } }))
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
	command('entity.duplicate', 'Duplicate Selected Entities', 'Entity', () => {
		const copies = session.selected.map((entity) => session.duplicate(entity)).filter((copy): copy is Entity => copy !== undefined)
		session.selectMany(copies)
	}, 'hasSelection')
	command('entity.makePlayer', 'Make Selected a Player', 'Entity', () => {
		const entity = session.selection
		if (entity !== undefined) session.addComponents(entity, { body: { kind: 'dynamic' }, collider: colliderSize(entity), controller: {} })
	}, 'hasSelection')
	command('entity.makeSolid', 'Make Selected Solid', 'Entity', () => {
		const entity = session.selection
		if (entity !== undefined) session.addComponents(entity, { body: { kind: 'static' }, collider: colliderSize(entity) })
	}, 'hasSelection')
	command('entity.saveAsPrefab', 'Save Selected as Prefab', 'Entity', async () => {
		const entity = session.selection
		if (entity === undefined) return
		const text = session.prefabText(entity)
		if (text === undefined) return fail('This entity cannot be saved as a prefab')
		const name = (await dialogs.prompt('Prefab name', { title: 'Save as prefab', value: session.nameOf(entity) }))?.trim()
		if (name === undefined || name === '') return
		await session.project.assets.createFolder('Prefabs')
		const result = await session.project.assets.importAsset(`${name}.prefab`, new TextEncoder().encode(text), 'Prefabs')
		if (!result.ok) return fail(result.error.message)
		hooks.revealFolder('Prefabs')
		session.notifyAssetsChanged()
	}, 'hasSelection')

	command('tool.move', 'Move Tool', 'Tools', () => contexts.set('tool', 'move'))
	command('tool.rotate', 'Rotate Tool', 'Tools', () => contexts.set('tool', 'rotate'))
	command('tool.scale', 'Scale Tool', 'Tools', () => contexts.set('tool', 'scale'))
	command('tool.rect', 'Rect Tool', 'Tools', () => contexts.set('tool', 'rect'))

	command('edit.copy', 'Copy', 'Edit', () => void copySelection(), 'hasSelection')
	command('edit.selectAll', 'Select All', 'Edit', () => session.selectAll())
	command('edit.cut', 'Cut', 'Edit', () => {
		if (copySelection()) session.deleteSelected()
	}, 'hasSelection')
	command('edit.paste', 'Paste', 'Edit', () => {
		if (clipboard !== undefined) session.paste(clipboard)
	}, 'hasClipboard')
	command('edit.undo', 'Undo', 'Edit', () => void session.undo(), 'canUndo')
	command('edit.redo', 'Redo', 'Edit', () => void session.redo(), 'canRedo')

	command('script.new', 'New Script', 'Script', async (args) => {
		const folder = folderArg(args) ?? ''
		let name = 'NewScript.ts'
		for (let index = 2; session.project.assets.find(name, folder) !== undefined; index++) name = `NewScript${index}.ts`
		const result = await session.project.assets.importAsset(name, new TextEncoder().encode(SCRIPT_TEMPLATE), folder)
		if (!result.ok) return fail(result.error.message)
		hooks.revealFolder(folder)
		session.notifyAssetsChanged()
		hooks.openScript(result.value.id)
	})
	command('script.edit', 'Edit Script', 'Script', (args) => {
		const id = assetArg(args)
		const record = id === undefined ? undefined : session.project.assets.get(id as Guid)
		if (record?.kind !== 'script') throw new Error('Choose a script in the Assets panel first')
		hooks.openScript(record.id)
	})

	command('folder.new', 'New Folder', 'Asset', async (args) => {
		const parent = folderArg(args) ?? ''
		const name = await dialogs.prompt(parent === '' ? 'Folder name' : `New folder in ${parent}`, { title: 'New folder' })
		if (!name) return
		if (name === null || name.trim() === '') return
		const path = parent === '' ? name.trim() : `${parent}/${name.trim()}`
		const result = await session.project.assets.createFolder(path)
		if (!result.ok) return fail(result.error.message)
		hooks.revealFolder(path)
		session.notifyAssetsChanged()
	})
	command('folder.rename', 'Rename Folder', 'Asset', async (args) => {
		const folder = folderArg(args)
		if (folder === undefined || folder === '') return fail('Choose a folder in the Explorer first')
		const name = await dialogs.prompt('New folder name', { title: 'Rename folder', value: folder.slice(folder.lastIndexOf('/') + 1) })
		if (!name) return
		if (name === null || name.trim() === '') return
		const result = await session.project.assets.renameFolder(folder, name)
		if (!result.ok) return fail(result.error.message)
		session.notifyAssetsChanged()
	})
	command('folder.delete', 'Delete Folder', 'Asset', async (args) => {
		const folder = folderArg(args)
		if (folder === undefined || folder === '') return fail('Choose a folder in the Explorer first')
		const inside = session.project.assets.list().filter((asset) => asset.folder === folder || asset.folder.startsWith(`${folder}/`))
		const used = inside.reduce((total, asset) => total + session.assetUsage(asset.id), 0)
		const warning = used > 0 ? `\n\n${used} component${used === 1 ? '' : 's'} in the scene use these files and will lose them.` : ''
		if (!(await dialogs.confirm(`Delete the folder "${folder}" and the ${inside.length} file${inside.length === 1 ? '' : 's'} in it?${warning}`, { title: 'Delete folder', okLabel: 'Delete', danger: true }))) return
		const result = await session.project.assets.deleteFolder(folder)
		if (!result.ok) return fail(result.error.message)
		session.notifyAssetsChanged()
	})

	command('prefab.instantiate', 'Instantiate Prefab', 'Asset', instantiatePrefab)

	command('scene.switch', 'Switch Scene', 'Scene', async (args) => {
		const names = await session.scenes()
		const name = sceneArg(args) ?? (await dialogs.choose('Switch to which scene?', names.map((value) => ({ label: value, value })), { title: 'Switch scene' }))
		if (name === undefined || name === '' || name === session.scene) return
		if (!(await leaveScene())) return
		const result = await session.switchScene(name)
		if (!result.ok) return fail(result.error.message)
	})
	command('scene.new', 'New Scene', 'Scene', async () => {
		const name = (await dialogs.prompt('New scene name', { title: 'New scene', validate: (value) => (value.trim() === '' ? 'Enter a name' : undefined) }))?.trim()
		if (name === undefined || name === '') return
		const created = await session.newScene(name)
		if (!created.ok) return fail(created.error.message)
		if (!(await leaveScene())) return
		const result = await session.switchScene(name)
		if (!result.ok) return fail(result.error.message)
	})
	command('scene.rename', 'Rename Scene', 'Scene', async () => {
		const name = (await dialogs.prompt('New scene name', { title: 'Rename scene', value: session.scene }))?.trim()
		if (name === undefined || name === '' || name === session.scene) return
		const result = await session.renameScene(session.scene, name)
		if (!result.ok) return fail(result.error.message)
	})
	command('scene.delete', 'Delete Scene', 'Scene', async (args) => {
		const names = await session.scenes()
		const name = sceneArg(args) ?? (await dialogs.choose('Delete which scene?', names.map((value) => ({ label: value, value })), { title: 'Delete scene' }))
		if (name === undefined || name === '') return
		if (!(await dialogs.confirm(`Delete the scene "${name}"? This cannot be undone.`, { title: 'Delete scene', okLabel: 'Delete', danger: true }))) return
		const result = await session.deleteScene(name)
		if (!result.ok) return fail(result.error.message)
	})

	command('graph.new', 'New Graph', 'Script', async (args) => {
		const folder = folderArg(args) ?? ''
		let name = 'NewGraph.graph'
		for (let index = 2; session.project.assets.find(name, folder) !== undefined; index++) name = `NewGraph${index}.graph`
		const result = await session.project.assets.importAsset(name, new TextEncoder().encode(emptyGraphText()), folder)
		if (!result.ok) return fail(result.error.message)
		hooks.revealFolder(folder)
		session.notifyAssetsChanged()
		hooks.openGraph(result.value.id)
	})
	command('graph.edit', 'Edit Graph', 'Script', (args) => {
		const id = assetArg(args)
		const record = id === undefined ? undefined : session.project.assets.get(id as Guid)
		if (record?.kind !== 'graph') throw new Error('Choose a graph in the Explorer first')
		hooks.openGraph(record.id)
	})

	command('game.export', 'Export Game…', 'Game', () => hooks.openExport())
	command('game.controls', 'Edit Touch Controls…', 'Game', () => hooks.openControls())

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
		{ keys: 'f5', command: 'play.start' },
		{ keys: 'w', command: 'tool.move', when: '!textInputFocus' },
		{ keys: 'e', command: 'tool.rotate', when: '!textInputFocus' },
		{ keys: 'r', command: 'tool.scale', when: '!textInputFocus' },
		{ keys: 'mod+c', command: 'edit.copy', when: 'hasSelection && !textInputFocus' },
		{ keys: 'mod+x', command: 'edit.cut', when: 'hasSelection && !textInputFocus' },
		{ keys: 'mod+v', command: 'edit.paste', when: 'hasClipboard && !textInputFocus' },
		{ keys: 't', command: 'tool.rect', when: '!textInputFocus' },
		{ keys: 'mod+a', command: 'edit.selectAll', when: '!textInputFocus' },
	])
	if (!added.ok) throw added.error

	// Contibutions

	const contribute = (menu: string, item: Parameters<MenuRegistry['add']>[1]): void => { store.add(menus.add(menu, item)) }

	contribute('entity/create', { command: 'entity.add', title: 'Entity', group: '1_create@1' })
	contribute('entity/create', { command: 'entity.addChild', title: 'Child Entity', group: '1_create@2' })
	for (const menu of ['outline/context', 'viewport/context']) {
		contribute(menu, { command: 'entity.makePlayer', group: '2_modify@3', when: 'hasSelection' })
		contribute(menu, { command: 'entity.makeSolid', group: '2_modify@4', when: 'hasSelection' })
	}

	contribute('outline/context', { submenu: 'entity/create', title: 'Create', group: '1_create' })
	contribute('outline/context', { command: 'entity.rename', group: '2_modify@1' })
	contribute('outline/context', { command: 'entity.delete', group: '2_modify@2' })
	contribute('outline/context', { command: 'edit.undo', group: '3_history@1' })
	contribute('outline/context', { command: 'edit.redo', group: '3_history@2' })
	contribute('outline/context', { command: 'workbench.action.showCommands', group: '9_misc' })
	contribute('outline/context', { command: 'entity.duplicate', group: '2_modify@0' })
	contribute('outline/context', { command: 'play.start', group: '5_play' })

	contribute('viewport/context', { command: 'entity.addAt', group: '1_create@1' })
	contribute('viewport/context', { command: 'entity.addChild', group: '1_create@2', when: 'hasSelection' })
	contribute('viewport/context', { command: 'entity.rename', group: '2_modify@1', when: 'hasSelection' })
	contribute('viewport/context', { command: 'entity.delete', group: '2_modify@2', when: 'hasSelection' })
	contribute('viewport/context', { command: 'edit.undo', group: '3_history@1' })
	contribute('viewport/context', { command: 'edit.redo', group: '3_history@2' })
	contribute('viewport/context', { command: 'view.toggleGrid', title: 'Show Grid', group: '4_view', toggled: 'gridVisible' })
	contribute('viewport/context', { command: 'workbench.action.showCommands', group: '9_misc' })
	contribute('viewport/context', { command: 'entity.duplicate', group: '2_modify@0', when: 'hasSelection' })
	contribute('viewport/context', { command: 'entity.addPlayer', group: '1_create@3' })
	contribute('viewport/context', { command: 'entity.addPlatform', group: '1_create@4' })
	contribute('viewport/context', { command: 'entity.addCamera', group: '1_create@5' })
	contribute('viewport/context', { command: 'play.start', group: '5_play' })

	for (const menu of ['outline/context', 'viewport/context']) contribute(menu, { command: 'entity.saveAsPrefab', group: '2_modify@5', when: 'hasSelection' })
	for (const menu of ['outline/context', 'viewport/context']) {
		contribute(menu, { command: 'edit.copy', group: '2_edit@1' })
		contribute(menu, { command: 'edit.cut', group: '2_edit@2' })
		contribute(menu, { command: 'edit.paste', group: '2_edit@3' })
	}

	contribute('assets/context', { command: 'asset.addToScene', group: '1_create', when: "assetKind == 'image'" })
	contribute('assets/context', { command: 'asset.assignToSelection', group: '2_modify', when: "assetKind == 'image'" })
	contribute('assets/context', { command: 'script.edit', group: '3_script', when: "assetKind == 'script'" })
	contribute('assets/context', { command: 'prefab.instantiate', title: 'Instantiate in Scene', group: '1_create', when: "assetKind == 'prefab'" })

	contribute('explorer/context', { command: 'script.new', title: 'New Script', group: '1_new@1', when: isFolder })
	contribute('explorer/context', { command: 'folder.new', title: 'New Folder', group: '1_new@2', when: isFolder })
	contribute('explorer/context', { command: 'script.edit', group: '2_open@1', when: "assetKind == 'script'" })
	contribute('explorer/context', { command: 'asset.addToScene', group: '2_open@2', when: "assetKind == 'image'" })
	contribute('explorer/context', { command: 'asset.assignToSelection', group: '2_open@3', when: "assetKind == 'image'" })
	contribute('explorer/context', { command: 'asset.rename', group: '3_modify@1', when: isFile })
	contribute('explorer/context', { command: 'folder.rename', group: '3_modify@2', when: "assetKind == 'folder'" })
	contribute('explorer/context', { command: 'asset.delete', group: '3_modify@3', when: isFile })
	contribute('explorer/context', { command: 'folder.delete', group: '3_modify@4', when: "assetKind == 'folder'" })
	contribute('explorer/context', { command: 'prefab.instantiate', title: 'Instantiate in Scene', group: '2_open@2', when: "assetKind == 'prefab'" })
	contribute('explorer/context', { command: 'graph.new', title: 'New Graph', group: '1_new@3', when: isFolder })
	contribute('explorer/context', { command: 'graph.edit', title: 'Edit Graph', group: '2_open@1', when: "assetKind == 'graph'" })

	contribute('menubar/file', { command: 'file.save', group: '1_file' })
	contribute('menubar/file', { command: 'game.export', group: '2_export@1' })
	contribute('menubar/file', { command: 'game.controls', group: '2_export@2' })
	contribute('menubar/file', { command: 'project.close', group: '9_close' })
	contribute('menubar/edit', { command: 'edit.undo', group: '1_history@1' })
	contribute('menubar/edit', { command: 'edit.redo', group: '1_history@2' })
	contribute('menubar/edit', { command: 'edit.cut', group: '2_clipboard@1' })
	contribute('menubar/edit', { command: 'edit.copy', group: '2_clipboard@2' })
	contribute('menubar/edit', { command: 'edit.paste', group: '2_clipboard@3' })
	contribute('menubar/edit', { command: 'entity.duplicate', group: '3_modify@1' })
	contribute('menubar/edit', { command: 'entity.delete', group: '3_modify@2' })
	contribute('menubar/edit', { command: 'edit.selectAll', group: '3_modify@3' })
	contribute('menubar/scene', { command: 'scene.new', group: '1_scene@1' })
	contribute('menubar/scene', { command: 'scene.switch', group: '1_scene@2' })
	contribute('menubar/scene', { command: 'scene.rename', group: '1_scene@3' })
	contribute('menubar/scene', { command: 'scene.delete', group: '1_scene@4' })
	contribute('menubar/scene', { submenu: 'entity/create', title: 'Create', group: '2_entity@1' })
	contribute('menubar/scene', { command: 'entity.addPlayer', group: '2_entity@2' })
	contribute('menubar/scene', { command: 'entity.addPlatform', group: '2_entity@3' })
	contribute('menubar/scene', { command: 'entity.addCamera', group: '2_entity@4' })
	contribute('menubar/project', { command: 'script.new', group: '1_new@1' })
	contribute('menubar/project', { command: 'graph.new', group: '1_new@2' })
	contribute('menubar/project', { command: 'game.controls', group: '2_game' })
	contribute('menubar/view', { command: 'view.toggleGrid', title: 'Show Grid', group: '1_view@1', toggled: 'gridVisible' })
	contribute('menubar/view', { command: 'view.mode2d', group: '1_view@2' })
	contribute('menubar/view', { command: 'view.mode3d', group: '1_view@3' })
	contribute('menubar/view', { command: 'view.resetLayout', group: '2_layout' })
	contribute('menubar/view', { command: 'workbench.action.showCommands', group: '3_commands' })
	contribute('menubar/help', { command: 'workbench.action.showCommands', group: '1_help@1' })
	contribute('menubar/help', { command: 'help.about', group: '1_help@2' })

	return { contexts, commands, keybindings, menus, dispose: () => store.dispose() }
}
