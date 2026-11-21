/** @jsxImportSource @gambrel/view */
import { signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import { EditorSession } from '@strata/editor-core'
import type { Project } from '@strata/project'
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

	const close = (session: EditorSession): void => {
		if (session.dirty && !confirm('This project has unsaved changes. Close it without saving?')) return
		view.set({ kind: 'launcher' })
		session.dispose()
	}

	return (
		<div class="app">
			{() => {
				const current = view()
				return current.kind === 'launcher' ? (<Launcher onOpen={open} />) : (<Workspace session={current.session} onClose={() => close(current.session)} />)
			}}
		</div>
	)
}
