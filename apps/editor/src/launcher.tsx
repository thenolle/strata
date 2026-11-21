/** @jsxImportSource @gambrel/view */
import { Button, EmptyState } from '@gambrel/components'
import { signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import type { Result } from '@strata/core'
import type { Project } from '@strata/project'
import { createProject, deleteProject, listProjects, openProject, type ProjectSummary } from './projects.ts'

export function Launcher(props: { readonly onOpen: (project: Project) => Promise<string | undefined> }): Child {
	const projects = signal<readonly ProjectSummary[] | undefined>(undefined)
	const message = signal('')
	const busy = signal(false)

	const refresh = async (): Promise<void> => {
		const result = await listProjects()
		if (result.ok) {
			projects.set(result.value)
			return
		}
		projects.set([])
		message.set(result.error.message)
	}

	const enter = async (task: () => Promise<Result<Project>>): Promise<void> => {
		busy.set(true)
		message.set('')
		try {
			const result = await task()
			if (!result.ok) {
				message.set(result.error.message)
				return
			}
			const failure = await props.onOpen(result.value)
			if (failure !== undefined) message.set(failure)
		} finally {
			busy.set(false)
		}
	}

	const remove = async (summary: ProjectSummary): Promise<void> => {
		if (!confirm(`Delete "${summary.name}" and everything in it? This cannot be undone.`)) return
		const result = await deleteProject(summary.storageName)
		if (!result.ok) message.set(result.error.message)
		await refresh()
	}

	return (
		<section
			class="launcher"
			ref={() => {
				void refresh()
			}}
		>
			<header>
				<h1>Strata</h1>
				<p class="panel-empty">Projects are stored in this browser.</p>
			</header>
			<form
				class="launcher-create"
				onSubmit={(event) => {
					event.preventDefault()
					const form = event.currentTarget as HTMLFormElement
					const name = String(new FormData(form).get('name') ?? '').trim()
					if (name === '') return
					form.reset()
					void enter(() => createProject(name))
				}}
			>
				<input name="name" required maxlength={128} placeholder="New project name" autocomplete="off" />
				<Button type="submit" disabled={busy}>Create project</Button>
			</form>
			{() => (message() === '' ? null : <p class="notice" role="alert">{message()}</p>)}
			{() => {
				const list = projects()
				if (list === undefined) return <p class="panel-empty">Loading projects…</p>
				if (list.length === 0) return <EmptyState title="No projects yet" description="Create your first project above." />
				return (
					<ul class="project-list">
						{list.map((summary) => (
							<li class="project-item">
								<div class="meta">
									<strong>{summary.name}</strong>
									<small>Created {new Date(summary.createdAt).toLocaleString()}</small>
								</div>
								<Button size="sm" disabled={busy} onClick={() => void enter(() => openProject(summary.storageName))}>Open</Button>
								<Button size="sm" variant="outline" disabled={busy} onClick={() => void remove(summary)}>Delete</Button>
							</li>
						))}
					</ul>
				)
			}}
		</section>
	)
}
