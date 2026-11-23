/** @jsxImportSource @gambrel/view */
import { Button, EmptyState } from '@gambrel/components'
import { onCleanup, signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import type { Result } from '@strata/core'
import type { Project } from '@strata/project'
import { createProject, deleteProject, duplicateProject, exportProject, importProject, listProjects, openProject, protectStorage, renameProject, storageInfo, type ProjectSummary, type StorageInfo } from './projects.ts'
import { askPassword } from './password-dialog.ts'
import { MIN_PASSWORD, isSealed } from './seal.ts'
import { dialogs } from './dialogs.tsx'

const MAX_IMPORT_BYTES = 1024 * 1024 * 1024

function size(bytes: number): string {
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function ago(time: number): string {
	const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
	if (seconds < 60) return 'just now'
	if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
	if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
	return `${Math.floor(seconds / 86400)} d ago`
}

function download(fileName: string, bytes: Uint8Array): void {
	const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/zip' }))
	const link = document.createElement('a')
	link.href = url
	link.download = fileName
	document.body.append(link)
	link.click()
	link.remove()
	setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function Launcher(props: { readonly onOpen: (project: Project) => Promise<string | undefined> }): Child {
	const projects = signal<readonly ProjectSummary[] | undefined>(undefined)
	const message = signal('')
	const busy = signal(false)
	const filter = signal('')
	const info = signal<StorageInfo | undefined>(undefined)

	const refresh = async (): Promise<void> => {
		const result = await listProjects()
		if (result.ok) projects.set(result.value)
		else {
			projects.set([])
			message.set(result.error.message)
		}
		info.set(await storageInfo())
	}

	const act = async (task: () => Promise<Result<unknown>>, done = ''): Promise<void> => {
		busy.set(true)
		message.set('')
		try {
			const result = await task()
			message.set(result.ok ? done : result.error.message)
		} finally {
			busy.set(false)
			await refresh()
		}
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
		if (!(await dialogs.confirm(`Delete "${summary.name}" and everything in it? This cannot be undone. Export it first if you may want it back.`, { title: 'Delete project', okLabel: 'Delete', danger: true }))) return
		await act(() => deleteProject(summary.storageName))
	}

	const rename = async (summary: ProjectSummary): Promise<void> => {
		const name = (await dialogs.prompt('Project name', { title: 'Rename project', value: summary.name }))?.trim()
		if (name === undefined || name === '' || name === summary.name) return
		await act(() => renameProject(summary.storageName, name))
	}

	const save = async (summary: ProjectSummary): Promise<void> => {
		const password = await askPassword({ title: `Encrypt "${summary.name}"`, confirm: true, minLength: MIN_PASSWORD })
		if (password === undefined) return
		await act(async () => {
			const result = await exportProject(summary.storageName, password)
			if (result.ok) download(result.value.fileName, result.value.bytes)
			return result
		}, `Exported "${summary.name}" as an encrypted file. Keep the password safe: it cannot be recovered.`)
	}

	const load = async (file: File): Promise<void> => {
		if (file.size > MAX_IMPORT_BYTES) {
			message.set('That file is larger than 1 GB')
			return
		}
		const bytes = new Uint8Array(await file.arrayBuffer())
		let password = ''
		if (isSealed(bytes)) {
			const entered = await askPassword({ title: `Open ${file.name}`, confirm: false, minLength: 1 })
			if (entered === undefined) return
			password = entered
		}
		await act(() => importProject(bytes, password), `Imported ${file.name}`)
	}

	const protect = async (): Promise<void> => {
		const granted = await protectStorage()
		message.set(granted ? 'Your projects are now protected from automatic clean-up.' : 'The browser did not grant protection. Export your projects regularly instead.')
		info.set(await storageInfo())
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
				<p class="panel-empty">Projects are stored in this browser. Export them to keep a copy.</p>
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
				<Button type="submit" disabled={busy}>
					Create project
				</Button>
			</form>
			<div class="launcher-tools">
				<input
					type="search"
					placeholder="Search projects"
					aria-label="Search projects"
					ref={(element: Element) => {
						const input = element as HTMLInputElement
						const onInput = (): void => filter.set(input.value)
						input.addEventListener('input', onInput)
						onCleanup(() => input.removeEventListener('input', onInput))
					}}
				/>
				<label class="launcher-import">
					<span>Import project…</span>
					<input
						type="file"
						accept=".zip,application/zip"
						hidden
						ref={(element: Element) => {
							const input = element as HTMLInputElement
							const onChange = (): void => {
								const file = input.files?.[0]
								input.value = ''
								if (file !== undefined) void load(file)
							}
							input.addEventListener('change', onChange)
							onCleanup(() => input.removeEventListener('change', onChange))
						}}
					/>
				</label>
			</div>
			{() => (message() === '' ? null : <p class="notice" role="alert">{message()}</p>)}
			{() => {
				const list = projects()
				if (list === undefined) return <p class="panel-empty">Loading projects…</p>
				if (list.length === 0) return <EmptyState title="No projects yet" description="Create your first project above, or import one." />
				const query = filter().trim().toLowerCase()
				const shown = list.filter((summary) => summary.name.toLowerCase().includes(query))
				if (shown.length === 0) return <p class="panel-empty">No project matches "{filter()}".</p>
				return (
					<ul class="project-list">
						{shown.map((summary) => (
							<li class="project-item">
								<div class="meta">
									<strong>{summary.name}</strong>
									<small>
										{summary.openedAt > 0 ? `Opened ${ago(summary.openedAt)} · ` : ''}Created {new Date(summary.createdAt).toLocaleDateString()}
									</small>
								</div>
								<div class="project-actions">
									<Button size="sm" disabled={busy} onClick={() => void enter(() => openProject(summary.storageName))}>
										Open
									</Button>
									<Button size="sm" variant="outline" disabled={busy} onClick={() => void rename(summary)}>
										Rename
									</Button>
									<Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => duplicateProject(summary.storageName), `Duplicated "${summary.name}"`)}>
										Duplicate
									</Button>
									<Button size="sm" variant="outline" disabled={busy} onClick={() => void save(summary)}>
										Export
									</Button>
									<Button size="sm" variant="outline" disabled={busy} onClick={() => void remove(summary)}>
										Delete
									</Button>
								</div>
							</li>
						))}
					</ul>
				)
			}}
			{() => {
				const data = info()
				if (data === undefined) return null
				return (
					<p class="storage-info">
						{`Using ${size(data.usage)} of ${size(data.quota)} · ${data.persistent ? 'Protected from automatic clean-up' : 'Not protected: the browser may clear it when space runs low'}`}
						{data.persistent ? null : (
							<Button size="sm" variant="ghost" onClick={() => void protect()}>
								Protect
							</Button>
						)}
					</p>
				)
			}}
		</section>
	)
}
