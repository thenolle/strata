/** @jsxImportSource @gambrel/view */
import { Button } from '@gambrel/components'
import { onCleanup, signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import type { Entity } from '@strata/core'
import type { EditorSession } from '@strata/editor-core'
import { Inspector } from './inspector.tsx'
import { logger } from './logger.ts'
import { startViewport } from './viewport.ts'

export function Workspace(props: { readonly session: EditorSession; readonly onClose: () => void }): Child {
	const session = props.session
	const outlineRevision = signal(0)
	const fieldRevision = signal(0)
	const selected = signal<Entity | undefined>(session.selection)
	const saveState = signal('')
	const status = signal('Starting graphics')

	const save = async (): Promise<void> => {
		const result = await session.save()
		saveState.set(result.ok ? 'Saved' : `Save failed: ${result.error.message}`)
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
					if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
						event.preventDefault()
						void save()
					}
				}
				const onBeforeUnload = (event: BeforeUnloadEvent): void => {
					if (session.dirty) event.preventDefault()
				}
				addEventListener('keydown', onKeyDown)
				addEventListener('beforeunload', onBeforeUnload)
				onCleanup(() => {
					subscription.dispose()
					removeEventListener('keydown', onKeyDown)
					removeEventListener('beforeunload', onBeforeUnload)
				})
			}}
		>
			<header class="workspace-bar">
				<strong>{session.project.name}</strong>
				<span class="dirty">
					{() => {
						fieldRevision()
						return session.dirty ? 'Unsaved changes' : saveState()
					}}
				</span>
				<span class="spacer"></span>
				<Button size="sm" onClick={() => void save()}>
					Save
				</Button>
				<Button size="sm" variant="outline" onClick={props.onClose}>
					Close project
				</Button>
			</header>
			<aside class="panel outline" aria-label="Hierarchy">
				<div class="panel-actions">
					<Button size="sm" onClick={() => session.createEntity({})}>
						Add entity
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={() => selected() === undefined}
						onClick={() => {
							const parent = session.selection
							if (parent !== undefined) session.createEntity({ parent })
						}}
					>
						Add child
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={() => selected() === undefined}
						onClick={() => {
							session.deleteSelected()
						}}
					>
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
		</div>
	)
}
