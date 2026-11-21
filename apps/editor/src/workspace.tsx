/** @jsxImportSource @gambrel/view */
import { Button } from '@gambrel/components'
import { onCleanup, signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import type { Entity } from '@strata/core'
import type { EditorSession } from '@strata/editor-core'
import { Inspector } from './inspector.tsx'
import { logger } from './logger.ts'
import { CommandPalette } from './palette.tsx'
import { createStudio } from './studio.ts'
import { startViewport } from './viewport.ts'

function isTextInput(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
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

	const save = async (): Promise<void> => {
		const result = await session.save()
		saveState.set(result.ok ? 'Saved' : `Save failed: ${result.error.message}`)
	}

	const setPalette = (open: boolean): void => {
		studio.contexts.set('paletteOpen', open)
		paletteOpen.set(open)
	}

	const studio = createStudio(session, { save, close: props.onClose, openPalette: () => setPalette(true) })

	const run = (id: string, args?: unknown): void => {
		void studio.commands.execute(id, args).then((result) => notice.set(result.ok ? '' : result.error.message))
	}

	return (
		<div
			class="workspace"
			ref={() => {
				const subscription = session.changed.subscribe((kind) => {
					fieldRevision.update((value) => value + 1)
					if (kind !== 'transform') outlineRevision.update((value) => value + 1)
					selected.set(session.selection)
				})
				const onKeyDown = (event: KeyboardEvent): void => {
					const outcome = studio.keybindings.handle(event)
					if (outcome.kind === 'none') return
					event.preventDefault()
					if (outcome.kind === 'command') run(outcome.command, outcome.args)
				}
				const onFocusIn = (event: FocusEvent): void => studio.contexts.set('textInputFocus', isTextInput(event.target))
				const onFocusOut = (): void => studio.contexts.set('textInputFocus', false)
				const onBeforeUnload = (event: BeforeUnloadEvent): void => {
					if (session.dirty) event.preventDefault()
				}
				addEventListener('keydown', onKeyDown)
				addEventListener('beforeunload', onBeforeUnload)
				document.addEventListener('focusin', onFocusIn)
				document.addEventListener('focusout', onFocusOut)
				onCleanup(() => {
					subscription.dispose()
					studio.dispose()
					removeEventListener('keydown', onKeyDown)
					removeEventListener('beforeunload', onBeforeUnload)
					document.removeEventListener('focusin', onFocusIn)
					document.removeEventListener('focusout', onFocusOut)
				})
			}}
		>
			<header class="workspace-bar">
				<strong>{session.project.name}</strong>
				<span class="dirty">
					{() => {
						fieldRevision()
						const message = notice()
						if (message !== '') return message
						return session.dirty ? 'Unsaved changes' : saveState()
					}}
				</span>
				<span class="spacer"></span>
				<Button size="sm" variant="ghost" onClick={() => setPalette(true)}>
					Commands
				</Button>
				<Button size="sm" onClick={() => run('file.save')}>
					Save
				</Button>
				<Button size="sm" variant="outline" onClick={() => run('project.close')}>
					Close project
				</Button>
			</header>
			<aside class="panel outline" aria-label="Hierarchy">
				<div class="panel-actions">
					<Button size="sm" onClick={() => run('entity.add')}>
						Add entity
					</Button>
					<Button size="sm" variant="outline" disabled={() => selected() === undefined} onClick={() => run('entity.addChild')}>
						Add child
					</Button>
					<Button size="sm" variant="outline" disabled={() => selected() === undefined} onClick={() => run('entity.delete')}>
						Delete
					</Button>
				</div>
				{() => {
					outlineRevision()
					const rows = session.rows()
					if (rows.length === 0) return <p class="panel-empty">No entities yet. Add one to begin.</p>
					return (
						<ul class="rows">
							{rows.map((row) => (
								<li
									class="row"
									data-selected={String(session.selection === row.entity)}
									style={`padding-left:${8 + row.depth * 14}px`}
									onClick={() => session.select(row.entity)}
								>
									{row.name === '' ? '(unnamed)' : row.name}
								</li>
							))}
						</ul>
					)
				}}
			</aside>
			<div
				class="viewport"
				ref={(element: Element) => {
					const stop = startViewport({
						host: element as HTMLElement,
						session,
						logger: logger.child('viewport'),
						onStatus: (text) => status.set(text)
					})
					onCleanup(stop)
				}}
			></div>
			<aside class="panel inspector" aria-label="Inspector">
				<Inspector session={session} selected={selected} revision={fieldRevision} />
			</aside>
			<footer class="workspace-status">{status}</footer>
			{() =>
				paletteOpen() ? (
					<CommandPalette
						registry={studio.commands}
						keybindings={studio.keybindings}
						onRun={(id) => {
							setPalette(false)
							run(id)
						}}
						onClose={() => setPalette(false)}
					/>
				) : null
			}
		</div>
	)
}
