/** @jsxImportSource @gambrel/view */
import { Button } from '@gambrel/components'
import { onCleanup, signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import type { Entity, Guid } from '@strata/core'
import type { EditorSession } from '@strata/editor-core'
import { ContextMenu, type MenuRequest } from './context-menu.tsx'
import { Inspector } from './inspector.tsx'
import { attachLongPress } from './long-press.ts'
import { logger } from './logger.ts'
import { CommandPalette } from './palette.tsx'
import { createStudio } from './studio.ts'
import { Explorer } from './explorer.tsx'
import { PlayOverlay } from './play.tsx'
import { Workbench } from './workbench.tsx'
import { applyLayout, DEFAULT_LAYOUT, loadLayout, saveLayout, type Layout } from './layout.ts'
import { attachSplitter } from './splitter.ts'
import { IconButton } from './ui.tsx'
import { VIEWPORTS, loadMode, saveMode, type ViewMode } from './viewport-modes.ts'
import type { ViewportOptions } from './viewport.ts'
import { GraphEditor } from './graph-editor.tsx'
import { ExportDialog } from './export-dialog.tsx'
import { ControlsDialog } from './controls-dialog.tsx'
import { dialogOpen } from './dialogs.tsx'
import { output } from './output.ts'

const AUTOSAVE_KEY = 'strata.autosave'
const AUTOSAVE_MS = 30_000
const readAutosave = (): boolean => {
	try {
		return localStorage.getItem(AUTOSAVE_KEY) !== 'off'
	} catch {
		return true
	}
}

function isTextInput(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

function menuTarget(target: EventTarget | null): HTMLElement | null {
	return target instanceof Element ? target.closest<HTMLElement>('[data-menu]') : null
}

export function Workspace(props: { readonly session: EditorSession; readonly onClose: () => void }): Child {
	const session = props.session
	const outlineRevision = signal(0)
	const fieldRevision = signal(0)
	const selected = signal<Entity | undefined>(session.selection)
	const saveState = signal('')
	const notice = signal('')
	const status = signal('Starting graphics')
	const paletteOpen = signal(false)
	const menu = signal<MenuRequest | undefined>(undefined)
	const playing = signal(false)
	const ide = signal(false)
	const ideRequest = signal<{ readonly asset: Guid; readonly n: number } | undefined>(undefined)
	const reveal = signal<string | undefined>(undefined)
	const scenes = signal<readonly string[]>([session.scene])
	const graphAsset = signal<Guid | undefined>(undefined)
	const exporting = signal(false)
	const controlsOpen = signal(false)
	const refreshScenes = (): void => { void session.scenes().then((names) => scenes.set(names)) }
	refreshScenes()
	let rootElement: HTMLElement | undefined
	let anchor: Entity | undefined
	const layout: Layout = loadLayout()
	const toolbar = signal(0)
	let viewportHost: HTMLElement | undefined
	let stopViewport: (() => void) | undefined
	let placeholder: HTMLElement | undefined

	const split = (handle: Element, key: keyof Layout, axis: 'x' | 'y', direction: 1 | -1, min: number, max: () => number): void => {
		const refresh = (): void => {
			if (rootElement !== undefined) applyLayout(rootElement, layout)
		}
		onCleanup(
			attachSplitter(handle as HTMLElement, {
				axis,
				direction,
				min,
				max,
				value: () => layout[key],
				apply: (value) => {
					layout[key] = value
					refresh()
				},
				commit: () => saveLayout(layout),
				reset: () => {
					layout[key] = DEFAULT_LAYOUT[key]
					refresh()
					saveLayout(layout)
				}
			})
		)
	}
	const width = (): number => rootElement?.clientWidth ?? 1200
	const height = (): number => rootElement?.clientHeight ?? 800

	const save = async (): Promise<void> => {
		const result = await session.save()
		saveState.set(result.ok ? 'Saved' : `Save failed: ${result.error.message}`)
		if (result.ok) output.info(`Saved "${session.scene}"`)
		else output.error(`Save failed: ${result.error.message}`)
	}

	const setPalette = (open: boolean): void => {
		studio.contexts.set('paletteOpen', open)
		paletteOpen.set(open)
	}

	const openMenu = (request: MenuRequest): void => {
		setPalette(false)
		menu.set(request)
	}

	const openFor = (element: HTMLElement, x: number, y: number, keyboard = false): void => {
		const entity = element.dataset['entity']
		if (entity !== undefined) session.select(Number(entity) as Entity)
		const asset = element.dataset['asset']
		const folder = element.dataset['folder']
		studio.contexts.set('assetKind', element.dataset['kind'] ?? '')
		const args = asset === undefined && folder === undefined ? undefined : { ...(asset === undefined ? {} : { asset }), ...(folder === undefined ? {} : { folder }) }
		openMenu({ menuId: element.dataset['menu'] ?? '', x, y, keyboard, ...(args === undefined ? {} : { args }) })
	}

	const showContextMenu = (): void => {
		const anchor = rootElement?.querySelector<HTMLElement>('.row[data-selected="true"]') ?? rootElement?.querySelector<HTMLElement>('.outline')
		if (anchor === null || anchor === undefined) return
		const rect = anchor.getBoundingClientRect()
		openFor(anchor.closest<HTMLElement>('[data-menu]') ?? anchor, rect.left + 24, rect.bottom - 2, true)
	}

	const studio = createStudio(session, {
		save,
		close: props.onClose,
		openPalette: () => setPalette(true),
		openContextMenu: showContextMenu,
		openScript: (asset) => {
			ide.set(true)
			ideRequest.set({ asset, n: (ideRequest.peek()?.n ?? 0) + 1 })
		},
		revealFolder: (path) => reveal.set(path),
		play: () => {
			session.select(undefined)
			setPalette(false)
			menu.set(undefined)
			playing.set(true)
		},
		openGraph: (asset) => graphAsset.set(asset),
		openExport: () => exporting.set(true),
		announce: (text) => notice.set(text),
		openControls: () => controlsOpen.set(true),
		resetLayout: () => {
			Object.assign(layout, DEFAULT_LAYOUT)
			if (rootElement !== undefined) applyLayout(rootElement, layout)
			saveLayout(layout)
		},
	})
	studio.contexts.set('viewMode', loadMode())
	studio.contexts.set('autosave', readAutosave())
	const filter = signal('')
	const viewportOptions = (host: HTMLElement): ViewportOptions => ({
		host,
		session,
		logger: logger.child('viewport'),
		onStatus: (text) => status.set(text),
		isGridVisible: () => studio.contexts.get('gridVisible') === true,
		getTool: () => {
			const tool = studio.contexts.get('tool')
			return tool === 'rotate' || tool === 'scale' || tool === 'rect' ? tool : 'move'
		},
		onContextMenu: (request) => openMenu({ menuId: 'viewport/context', x: request.x, y: request.y, args: request }),
		onDropAsset: (drop) => run('asset.addToScene', drop)
	})
	const mountViewport = (): void => {
		const host = viewportHost
		if (host === undefined) return
		stopViewport?.()
		stopViewport = undefined
		placeholder?.remove()
		placeholder = undefined
		const mode: ViewMode = studio.contexts.get('viewMode') === '3d' ? '3d' : '2d'
		const factory = VIEWPORTS[mode]
		if (factory !== undefined) {
			stopViewport = factory(viewportOptions(host))
			return
		}
		placeholder = document.createElement('div')
		placeholder.className = 'viewport-placeholder'
		placeholder.textContent = 'The 3D view arrives with the 3D renderer. Your scene is unchanged. Switch back to 2D to keep editing.'
		host.append(placeholder)
		status.set('3D view is not available yet')
	}

	const run = (id: string, args?: unknown): void => {
		void studio.commands.execute(id, args).then((result) => {
			notice.set(result.ok ? '' : result.error.message)
			if (!result.ok) output.error(`${id}: ${result.error.message}`)
		})
	}

	const MENUS: readonly (readonly [string, string])[] = [['File', 'menubar/file'], ['Edit', 'menubar/edit'], ['Scene', 'menubar/scene'], ['Project', 'menubar/project'], ['View', 'menubar/view'], ['Help', 'menubar/help']]
	const openBar = (button: HTMLElement, menuId: string, keyboard: boolean): void => {
		const rect = button.getBoundingClientRect()
		openMenu({ menuId, x: rect.left, y: rect.bottom + 2, keyboard })
	}

	return (
		<div class="workspace" ref={(element: Element) => {
			const root = element as HTMLElement
			rootElement = root
			applyLayout(root, layout)
			const subscription = session.changed.subscribe((kind) => {
				fieldRevision.update((value) => value + 1)
				if (kind !== 'transform') outlineRevision.update((value) => value + 1)
				if (kind === 'scene' || kind === 'saved') refreshScenes()
				selected.set(session.selection)
			})
			const contextSubscription = studio.contexts.changed.subscribe((name) => {
				if (name === 'viewMode') {
					saveMode(studio.contexts.get('viewMode') === '3d' ? '3d' : '2d')
					mountViewport()
				}
				if (name === 'viewMode' || name === 'tool') toolbar.update((value) => value + 1)
				if (name === 'autosave') {
					try {
						localStorage.setItem(AUTOSAVE_KEY, studio.contexts.get('autosave') === true ? 'on' : 'off')
					} catch {
						/* storage unavailable */
					}
				}
			})
			const onKeyDown = (event: KeyboardEvent): void => {
				if (playing() || ide() || graphAsset() !== undefined || exporting() || controlsOpen() || dialogOpen()) return
				const outcome = studio.keybindings.handle(event)
				if (outcome.kind === 'none') return
				event.preventDefault()
				if (outcome.kind === 'command') run(outcome.command, outcome.args)
			}
			const onContextMenu = (event: MouseEvent): void => {
				const target = menuTarget(event.target)
				if (target === null) return
				event.preventDefault()
				openFor(target, event.clientX, event.clientY)
			}
			const onFocusIn = (event: FocusEvent): void => studio.contexts.set('textInputFocus', isTextInput(event.target))
			const onFocusOut = (): void => studio.contexts.set('textInputFocus', false)
			const onBeforeUnload = (event: BeforeUnloadEvent): void => {
				if (session.dirty) event.preventDefault()
			}
			const detachLongPress = attachLongPress(root, (target, x, y) => {
				const found = menuTarget(target)
				if (found !== null) openFor(found, x, y)
			})
			const autosaveTimer = setInterval(() => {
				if (studio.contexts.get('autosave') !== true || !session.dirty || playing()) return
				void session.save().then((result) => {
					saveState.set(result.ok ? 'Autosaved' : `Autosave failed: ${result.error.message}`)
					if (!result.ok) output.error(`Autosave failed: ${result.error.message}`)
				})
			}, AUTOSAVE_MS)
			addEventListener('keydown', onKeyDown)
			addEventListener('beforeunload', onBeforeUnload)
			root.addEventListener('contextmenu', onContextMenu)
			document.addEventListener('focusin', onFocusIn)
			document.addEventListener('focusout', onFocusOut)
			onCleanup(() => {
				subscription.dispose()
				contextSubscription.dispose()
				studio.dispose()
				stopViewport?.()
				detachLongPress()
				clearInterval(autosaveTimer)
				removeEventListener('keydown', onKeyDown)
				removeEventListener('beforeunload', onBeforeUnload)
				root.removeEventListener('contextmenu', onContextMenu)
				document.removeEventListener('focusin', onFocusIn)
				document.removeEventListener('focusout', onFocusOut)
			})
		}}>
			<header class="workspace-bar">
				<strong class="workspace-title">{session.project.name}</strong>
				<nav class="menubar" aria-label="Menu">
					{MENUS.map(([label, id]) => (
						<button type="button" class="menubar-item" aria-haspopup="menu" onClick={(event) => openBar(event.currentTarget as HTMLElement, id, (event as unknown as MouseEvent).detail === 0)}>
							{label}
						</button>
					))}
				</nav>
				{() => (<select class="scene-select" title="Scene" aria-label="Scene" onChange={(event) => run('scene.switch', { name: (event.target as HTMLSelectElement).value })}>{scenes().map((name) => (<option value={name} selected={name === session.scene}>{name}</option>))}</select>)}
				<span class="dirty">
					{() => {
						fieldRevision()
						const message = notice()
						if (message !== '') return message
						return session.dirty ? 'Unsaved changes' : saveState()
					}}
				</span>
				<span class="spacer"></span>
				<Button size="sm" onClick={() => run('play.start')}>▶ Play</Button>
				<Button size="sm" variant="ghost" onClick={() => run('game.export')}>Export…</Button>
				<Button size="sm" variant="outline" onClick={() => run('file.save')}>Save</Button>
			</header>
			<aside class="panel outline" aria-label="Hierarchy" data-menu="outline/context">
				<div class="panel-title">Scene</div>
				<input class="panel-filter" type="search" placeholder="Filter entities" aria-label="Filter entities" onInput={(event) => filter.set((event.target as HTMLInputElement).value)} />
				<div class="panel-actions">
					<Button size="sm" onClick={() => run('entity.add')}>Add entity</Button>
					<Button size="sm" variant="outline" disabled={() => selected() === undefined} onClick={() => run('entity.addChild')}>Add child</Button>
					<Button size="sm" variant="outline" disabled={() => selected() === undefined} onClick={() => run('entity.delete')}>Delete</Button>
				</div>
				{() => {
					outlineRevision()
					const query = filter().trim().toLowerCase()
					const rows = session.rows().filter((row) => query === '' || row.name.toLowerCase().includes(query))
					if (rows.length === 0) return <p class="panel-empty">{query === '' ? 'No entities yet. Add one to begin.' : 'No entity matches the filter.'}</p>
					return (
						<ul class="rows">
							{rows.map((row) => (<li class="row" data-menu="outline/context" data-entity={String(row.entity)} data-selected={String(session.isSelected(row.entity))} style={`padding-left:${8 + row.depth * 14}px`} onClick={(event) => {
								const mouseEvent = event as unknown as MouseEvent
								if (mouseEvent.shiftKey && anchor !== undefined) {
									session.selectRange(anchor, row.entity)
								} else if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
									session.select(row.entity, 'toggle')
									anchor = row.entity
								} else {
									session.select(row.entity)
									anchor = row.entity
								}
							}}>{row.name === '' ? '(unnamed)' : row.name}</li>))}
						</ul>
					)
				}}
			</aside>
			<div class="viewport" ref={(element: Element) => {
				viewportHost = element as HTMLElement
				mountViewport()
			}}>
				<div class="viewport-toolbar">
					{() => {
						toolbar()
						const tool = studio.contexts.get('tool')
						const mode = studio.contexts.get('viewMode')
						return (<div class="toolbar-group">
							<IconButton icon="move" title="Move (W)" active={tool === 'move'} onClick={() => run('tool.move')} />
							<IconButton icon="rotate" title="Rotate (E)" active={tool === 'rotate'} onClick={() => run('tool.rotate')} />
							<IconButton icon="scale" title="Scale (R)" active={tool === 'scale'} onClick={() => run('tool.scale')} />
							<IconButton icon="rect" title="Rect: resize with handles (T)" active={tool === 'rect'} onClick={() => run('tool.rect')} />
							<span class="toolbar-divider"></span>
							<button type="button" class="mode-button" data-active={String(mode !== '3d')} title="2D view" onClick={() => run('view.mode2d')}>2D</button>
							<button type="button" class="mode-button" data-active={String(mode === '3d')} title="3D view" onClick={() => run('view.mode3d')}>3D</button>
						</div>)
					}}
				</div>
			</div>
			<div class="splitter splitter-col" data-edge="outline" ref={(handle: Element) => split(handle, 'outline', 'x', 1, 160, () => width() - layout.inspector - 320)}></div>
			<div class="splitter splitter-col" data-edge="inspector" ref={(handle: Element) => split(handle, 'inspector', 'x', -1, 200, () => width() - layout.outline - 320)}></div>
			<div class="splitter splitter-row" data-edge="assets" ref={(handle: Element) => split(handle, 'assets', 'y', -1, 90, () => height() - 44 - 28 - 160)}></div>
			<Explorer session={session} run={(id, args) => run(id, args)} onNotice={(text) => notice.set(text)} reveal={reveal} onOpen={(asset) => {
				if (asset.kind === 'script') run('script.edit', { asset: asset.id })
				if (asset.kind === 'graph') run('graph.edit', { asset: asset.id })
			}} output />
			<aside class="panel inspector" aria-label="Inspector"><div class="panel-title">Inspector</div><Inspector session={session} selected={selected} revision={fieldRevision} run={(id) => run(id)} /></aside>
			<footer class="workspace-status">{status}</footer>
			{() => paletteOpen() ? (<CommandPalette registry={studio.commands} keybindings={studio.keybindings} onRun={(id) => {
				setPalette(false)
				run(id)
			}} onClose={() => setPalette(false)} />) : null}
			{() => {
				const request = menu()
				return request === undefined ? null : (<ContextMenu request={request} studio={studio} onRun={(command, args) => run(command, args)} onClose={() => menu.set(undefined)} />)
			}}
			{() => (playing() ? <PlayOverlay session={session} onClose={() => playing.set(false)} /> : null)}
			{() => (ide() ? <Workbench session={session} request={ideRequest} run={(id, args) => run(id, args)} reveal={reveal} split={split} onClose={() => ide.set(false)} /> : null)}
			{() => {
				const asset = graphAsset()
				return asset === undefined ? null : <GraphEditor session={session} asset={asset} onClose={() => graphAsset.set(undefined)} />
			}}
			{() => (exporting() ? <ExportDialog session={session} onClose={() => exporting.set(false)} /> : null)}
			{() => (controlsOpen() ? <ControlsDialog session={session} onClose={() => controlsOpen.set(false)} /> : null)}
		</div>
	)
}
