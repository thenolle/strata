/** @jsxImportSource @gambrel/view */
import { effect, onCleanup, signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import type { Guid } from '@strata/core'
import type { EditorSession } from '@strata/editor-core'
import { Explorer } from './explorer.tsx'
import { createIcon } from './icons.ts'
import { CodeEditor } from './ide/code-editor.ts'
import guide from './ide/docs.txt'
import { ideClient, type Diagnostic } from './ide/ide-client.ts'
import { renderMarkdown } from './ide/markdown.ts'
import type { Layout } from './layout.ts'

interface Doc {
	readonly id: Guid
	readonly name: string
	readonly editor: CodeEditor
	dirty: boolean
	diagnostics: readonly Diagnostic[]
	line: number
	column: number
}

/**
 * The script IDE: files and docs sidebar, tabs, editors, a problems panel and a status bar.
 */
export function Workbench(props: {
	readonly session: EditorSession
	readonly request: () => { readonly asset: Guid; readonly n: number } | undefined
	readonly run: (command: string, args?: unknown) => void
	readonly reveal: () => string | undefined
	readonly split: (handle: Element, key: keyof Layout, axis: 'x' | 'y', direction: 1 | -1, min: number, max: () => number) => void
	readonly onClose: () => void
}): Child {
	const open = new Map<Guid, Doc>()
	const tabs = signal<readonly Guid[]>([])
	const active = signal<Guid | undefined>(undefined)
	const tick = signal(0)
	const view = signal<'files' | 'docs'>('files')
	const sidebar = signal(true)
	const message = signal('')
	let surface: HTMLElement | undefined
	let closed = false

	const bump = (): void => tick.update((value) => value + 1)
	const current = (): Doc | undefined => {
		const id = active()
		return id === undefined ? undefined : open.get(id)
	}

	const activate = (id: Guid | undefined): void => {
		active.set(id)
		for (const doc of open.values()) doc.editor.element.hidden = doc.id !== id
		if (id !== undefined) open.get(id)?.editor.focus()
		bump()
	}

	const save = async (id: Guid): Promise<void> => {
		const doc = open.get(id)
		if (doc === undefined) return
		const result = await props.session.project.assets.replaceScript(id, new TextEncoder().encode(doc.editor.value))
		if (!result.ok) {
			message.set(result.error.message)
			return
		}
		doc.dirty = false
		message.set(`Saved ${doc.name}`)
		props.session.notifyAssetsChanged()
		bump()
	}

	const closeTab = (id: Guid): void => {
		const doc = open.get(id)
		if (doc === undefined) return
		if (doc.dirty && !confirm(`Discard unsaved changes to ${doc.name}?`)) return
		doc.editor.dispose()
		open.delete(id)
		const remaining = tabs.peek().filter((tab) => tab !== id)
		tabs.set(remaining)
		if (active.peek() === id) activate(remaining[remaining.length - 1])
		else bump()
	}

	const openScript = async (id: Guid): Promise<void> => {
		if (open.has(id)) {
			activate(id)
			return
		}
		const record = props.session.project.assets.get(id)
		if (record === undefined || record.kind !== 'script') {
			message.set('Only scripts can be opened here')
			return
		}
		const bytes = await props.session.project.assets.read(id)
		if (closed || open.has(id)) return
		if (!bytes.ok) {
			message.set(bytes.error.message)
			return
		}
		const editor = new CodeEditor({
			name: id,
			text: new TextDecoder().decode(bytes.value),
			client: ideClient,
			onChange: () => {
				doc.dirty = true
				bump()
			},
			onSave: () => void save(id),
			onClose: () => undefined,
			onDiagnostics: (list) => {
				doc.diagnostics = list
				bump()
			},
			onCursor: (line, column) => {
				doc.line = line
				doc.column = column
				bump()
			}
		})
		const doc: Doc = { id, name: record.name, editor, dirty: false, diagnostics: [], line: 1, column: 1 }
		open.set(id, doc)
		surface?.append(editor.element)
		tabs.set([...tabs.peek(), id])
		activate(id)
	}

	const requestClose = (): void => {
		const dirty = [...open.values()].filter((doc) => doc.dirty)
		if (dirty.length > 0 && !confirm(`Discard unsaved changes in ${dirty.map((doc) => doc.name).join(', ')}?`)) return
		props.onClose()
	}

	return (
		<div class="wb-backdrop">
			<div
				class="wb"
				role="dialog"
				aria-label="Strata IDE"
				ref={() => {
					effect(() => {
						const request = props.request()
						if (request !== undefined) void openScript(request.asset)
					})
					onCleanup(() => {
						closed = true
						for (const doc of open.values()) doc.editor.dispose()
						open.clear()
					})
				}}
			>
				<header class="wb-title">
					<strong>Strata IDE</strong>
					<span>{props.session.project.name}</span>
					<span class="spacer"></span>
					<button class="wb-button" type="button" onClick={requestClose}>
						Back to editor
					</button>
				</header>
				<div class="wb-left">
					{() => (
						<nav class="wb-activity" aria-label="Views">
							{(['files', 'docs'] as const).map((id) => (
								<button
									type="button"
									class="wb-activity-button"
									data-active={String(sidebar() && view() === id)}
									title={id === 'files' ? 'Files' : 'Documentation'}
									ref={(element: Element) => element.append(createIcon(id === 'files' ? 'files' : 'book', 22))}
									onClick={() => {
										if (view() === id) sidebar.update((visible) => !visible)
										else {
											view.set(id)
											sidebar.set(true)
										}
									}}
								>
								</button>
							))}
						</nav>
					)}
					{() =>
						!sidebar() ? null : view() === 'docs' ? (
							<div class="wb-sidewrap">
								<aside
									class="wb-side script-docs"
									ref={(element: Element) => {
										element.append(
											renderMarkdown(guide, {
												onInsert: (code) => {
												const id = active.peek()
												if (id !== undefined) open.get(id)?.editor.insertText(code)
											}
										})
										)
									}}
								></aside>
								<div class="splitter splitter-col wb-handle" ref={(handle: Element) => props.split(handle, 'ideSide', 'x', 1, 180, () => 640)}></div>
							</div>
						) : (
							<div class="wb-sidewrap">
								<div class="wb-side">
									<Explorer
										session={props.session}
										kinds={['script']}
										run={props.run}
										reveal={props.reveal}
										onNotice={(text) => message.set(text)}
										onOpen={(asset) => {
											if (asset.kind === 'script') void openScript(asset.id)
										}}
									/>
								</div>
								<div class="splitter splitter-col wb-handle" ref={(handle: Element) => props.split(handle, 'ideSide', 'x', 1, 180, () => 640)}></div>
							</div>
						)
					}
				</div>
				<section class="wb-main">
					<div class="wb-tabs" role="tablist">
						{() => {
							tick()
							return tabs().map((id) => {
								const doc = open.get(id)
								return (
									<div class="wb-tab" role="tab" data-active={String(active() === id)}>
										<button type="button" class="wb-tab-label" onClick={() => activate(id)}>
											{doc?.name ?? 'Script'}
											{doc?.dirty === true ? ' ●' : ''}
										</button>
										<button type="button" class="wb-tab-close" title="Close" onClick={() => closeTab(id)}>
											×
										</button>
									</div>
								)
							})
						}}
					</div>
					<div
						class="wb-surface"
						ref={(element: Element) => {
							surface = element as HTMLElement
						}}
					>
						{() => (tabs().length === 0 ? <p class="wb-empty">Open a script from Files, or create one with New script.</p> : null)}
					</div>
					<div class="wb-problems">
						<div class="splitter splitter-row wb-problems-handle" ref={(handle: Element) => props.split(handle, 'ideProblems', 'y', -1, 60, () => 500)}></div>
						<div class="wb-panel-title">
							{() => {
								tick()
								const doc = current()
								return doc === undefined ? 'Problems' : `Problems (${doc.diagnostics.length})`
							}}
						</div>
						<ul class="script-problems">
							{() => {
								tick()
								const doc = current()
								const items = doc?.diagnostics ?? []
								if (items.length === 0) return <li class="ok">No problems</li>
								return items.map((item) => (
									<li class={item.severity === 1 ? 'error' : 'warning'} onClick={() => doc?.editor.reveal(item.line, item.character)}>
										{`${item.line + 1}:${item.character + 1}  ${item.message}`}
									</li>
								))
							}}
						</ul>
					</div>
				</section>
				<footer class="wb-status">
					<span>
						{() => {
							tick()
							const doc = current()
							const errors = doc?.diagnostics.filter((item) => item.severity === 1).length ?? 0
							const warnings = (doc?.diagnostics.length ?? 0) - errors
							return `${errors} errors   ${warnings} warnings   ${message()}`
						}}
					</span>
					<span class="spacer"></span>
					<span>
						{() => {
							tick()
							const doc = current()
							return doc === undefined ? '' : `Ln ${doc.line}, Col ${doc.column}    Tabs    TypeScript`
						}}
					</span>
				</footer>
			</div>
		</div>
	)
}
