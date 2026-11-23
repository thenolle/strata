/** @jsxImportSource @gambrel/view */
import { signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import { EditorSession } from '@strata/editor-core'
import type { Project } from '@strata/project'
import { dialogs, DialogHost } from './dialogs.tsx'
import { Launcher } from './launcher.tsx'
import { logger } from './logger.ts'
import { Workspace } from './workspace.tsx'

type View = { readonly kind: 'launcher' } | { readonly kind: 'workspace'; readonly session: EditorSession }

export function App(): Child {
	const view = signal<View>({ kind: 'launcher' })

	const open = async (project: Project): Promise<string | undefined> => {
		const session = await EditorSession.open(project, logger.child('session'))
		if (!session.ok) return session.error.message
		view.set({ kind: 'workspace', session: session.value })
		return undefined
	}

	const close = async (session: EditorSession): Promise<void> => {
		if (session.dirty && !(await dialogs.confirm('This project has unsaved changes. Close it without saving?', { title: 'Unsaved changes', okLabel: 'Close without saving', danger: true }))) return
		view.set({ kind: 'launcher' })
		session.dispose()
	}

	return (
		<div class="app">
			{() => {
				const current = view()
				return current.kind === 'launcher' ? (<Launcher onOpen={open} />) : (<Workspace session={current.session} onClose={() => void close(current.session)} />)
			}}
			<DialogHost />
		</div>
	)
}
