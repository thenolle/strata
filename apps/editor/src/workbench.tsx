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
import { runCompiled } from './ide/runner-client.ts'
import { bundleScript, collectScripts, scriptPath } from './ide/bundle-client.ts'
import { applyTextEdits } from './ide/editing.ts'
import type { FileEdits } from './ide/ide-client.ts'
import { quickPick, type PickItem } from './ide/quick-pick.ts'
import { SearchPanel } from './search-panel.tsx'

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
	const panel = signal<'problems' | 'output'>('problems')
	const output = signal<readonly string[]>([])
	const steps = signal(60)
	const keys = signal('')
	let running = false

	const print = (...lines: string[]): void => {
		output.set([...output.peek(), ...lines].slice(-500))
		panel.set('output')
	}

	const syncProject = async (): Promise<void> => {
		const files = await collectScripts(props.session.project.assets)
		await ideClient.project(Object.entries(files).map(([path, text]) => ({ path, text }))).catch(() => undefined)
		for (const doc of open.values()) doc.editor.invalidate()
	}

	const run = async (): Promise<void> => {
		const doc = current()
		if (doc === undefined || running) return
		running = true
		const held = keys.peek().split(/[\s,]+/).filter((key) => key !== '')
		print(`▶ ${doc.name} · ${steps.peek()} steps${held.length > 0 ? ` · holding ${held.join(', ')}` : ''}`)
		const record = props.session.project.assets.get(doc.id)
		const files = await collectScripts(props.session.project.assets, new Map([...open.values()].map((item) => [item.id, item.editor.value])))
		const bundled = record === undefined ? ({ ok: false, error: 'This script no longer exists' } as const) : await bundleScript(files, scriptPath(record))
		if (!bundled.ok) {
			running = false
			print(`✕ ${bundled.error}`)
			return
		}
		const outcome = await runCompiled(bundled.code, steps.peek(), held).catch((error: unknown) => ({ ok: false as const, error: String(error) }))
		running = false
		if (!outcome.ok) {
			print(`✕ ${outcome.error}`)
			return
		}
		const result = outcome.result
		print(
			...result.logs.map((line) => `  ${line}`),
			...result.errors.map((line) => `✕ ${line}`),
			`✓ finished in ${result.ms.toFixed(0)} ms · position (${result.transform.x.toFixed(2)}, ${result.transform.y.toFixed(2)})`
		)
	}

	const open = new Map<Guid, Doc>()
	const tabs = signal<readonly Guid[]>([])
	const active = signal<Guid | undefined>(undefined)
	const tick = signal(0)
	const view = signal<'files' | 'search' | 'docs'>('files')
	const sidebar = signal(true)
	const message = signal('')
	let surface: HTMLElement | undefined
	let rootEl: HTMLElement | undefined
	let overlay: (() => void) | undefined
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
		void syncProject()
		bump()
	}

	const closeTab = (id: Guid): void => {
		const doc = open.get(id)
		if (doc === undefined) return
		if (doc.dirty && !confirm(`Discard unsaved changes to ${doc.name}?`)) return
		doc.editor.dispose()
		open.delete(id)
		void syncProject()
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
			},
			onRun: () => void run(),
			onStatus: (text) => message.set(text),
			path: () => {
				const record = props.session.project.assets.get(id)
				return record === undefined ? `${id}.ts` : scriptPath(record)
			},
			onNavigate: (path, line, character) => void openAt(path, line, character),
			onOtherEdits: (files) => void applyOtherEdits(files),
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

	const recordAt = (path: string) => props.session.project.assets.list().find((record) => record.kind === 'script' && scriptPath(record) === path)

	const openAt = async (path: string, line: number, character: number): Promise<void> => {
		const record = recordAt(path)
		if (record === undefined) {
			message.set(`Cannot find ${path}`)
			return
		}
		await openScript(record.id)
		open.get(record.id)?.editor.reveal(line, character)
	}

	const applyTexts = async (changes: ReadonlyMap<string, string>): Promise<void> => {
		for (const [path, text] of changes) {
			const record = recordAt(path)
			if (record === undefined) continue
			const doc = open.get(record.id)
			if (doc !== undefined) {
				doc.editor.setText(text)
				continue
			}
			const saved = await props.session.project.assets.replaceScript(record.id, new TextEncoder().encode(text))
			if (!saved.ok) message.set(saved.error.message)
		}
		props.session.notifyAssetsChanged()
		message.set(`Updated ${changes.size} script${changes.size === 1 ? '' : 's'}`)
		void syncProject()
	}

	const applyOtherEdits = async (files: readonly FileEdits[]): Promise<void> => {
		const changes = new Map<string, string>()
		for (const file of files) {
			const record = recordAt(file.path)
			if (record === undefined) continue
			const doc = open.get(record.id)
			const source = doc !== undefined ? doc.editor.value : await props.session.project.assets.read(record.id).then((bytes) => (bytes.ok ? new TextDecoder().decode(bytes.value) : undefined))
			if (source !== undefined) changes.set(file.path, applyTextEdits(source, file.edits))
		}
		await applyTexts(changes)
	}

	const pick = <T,>(placeholder: string, items: readonly PickItem<T>[], onPick: (value: T) => void): void => {
		overlay?.()
		if (rootEl === undefined) return
		overlay = quickPick(rootEl, {
			placeholder,
			items,
			onPick,
			onClose: () => {
				overlay = undefined
				current()?.editor.focus()
			}
		})
	}

	const quickOpen = (): void => {
		const scripts = props.session.project.assets.list().filter((record) => record.kind === 'script')
		pick('Go to file', scripts.map((record) => ({ label: record.name, detail: record.folder, value: record.id })), (id) => void openScript(id))
	}

	const showSearch = (): void => {
		view.set('search')
		sidebar.set(true)
		queueMicrotask(() => rootEl?.querySelector<HTMLInputElement>('.wb-search input')?.focus())
	}

	const commandPalette = (): void => {
		const doc = current()
		const items: PickItem<() => void>[] = [
			{ label: 'Run Script', detail: 'Ctrl+Enter', value: () => void run() },
			{ label: 'Go to File…', detail: 'Ctrl+P', value: quickOpen },
			{ label: 'Search in All Scripts', detail: 'Ctrl+Shift+F', value: showSearch },
			...(doc === undefined ? [] : doc.editor.commands.map((command) => ({ label: command.label, detail: command.keys, value: command.run }))),
			{ label: 'Save', detail: 'Ctrl+S', value: () => { const id = active.peek(); if (id !== undefined) void save(id) } },
			{ label: 'Back to Editor', detail: '', value: requestClose }
		]
		pick('Type a command', items, (action) => action())
	}

	return (
		<div class="wb-backdrop">
			<div
				class="wb"
				role="dialog"
				aria-label="Strata IDE"
				ref={(element: Element) => {
					rootEl = element as HTMLElement
					const onKey = (event: Event): void => {
						const keyboardEvent = event as KeyboardEvent
						const command = keyboardEvent.ctrlKey || keyboardEvent.metaKey
						const key = keyboardEvent.key.toLowerCase()
						if (command && !keyboardEvent.shiftKey && key === 'p') {
							keyboardEvent.preventDefault()
							quickOpen()
						} else if ((command && keyboardEvent.shiftKey && key === 'p') || keyboardEvent.key === 'F1') {
							keyboardEvent.preventDefault()
							commandPalette()
						} else if (command && keyboardEvent.shiftKey && key === 'f') {
							keyboardEvent.preventDefault()
							showSearch()
						}
					}
					element.addEventListener('keydown', onKey)
					effect(() => {
						const request = props.request()
						if (request !== undefined) void openScript(request.asset)
					})
					let syncTimer: ReturnType<typeof setTimeout> | undefined
					const changes = props.session.changed.subscribe((kind) => {
						if (kind === 'transform') return
						clearTimeout(syncTimer)
						syncTimer = setTimeout(() => void syncProject(), 400)
					})
					void syncProject()
					onCleanup(() => {
						clearTimeout(syncTimer)
						changes.dispose()
						closed = true
						element.removeEventListener('keydown', onKey)
						overlay?.()
						for (const doc of open.values()) doc.editor.dispose()
						open.clear()
					})
				}}
			>
				<header class="wb-title">
					<strong>Strata IDE</strong>
					<span>{props.session.project.name}</span>
					<span class="spacer"></span>
					<span class="wb-run-config">
						<label>Steps <input type="number" min="1" max="3600" value="60" ref={(element: Element) => {
							const input = element as HTMLInputElement
							const onInput = (): void => steps.set(Math.max(1, Math.min(3600, Number(input.value) || 60)))
							input.addEventListener('input', onInput)
							onCleanup(() => input.removeEventListener('input', onInput))
						}} /></label>
						<label>Keys held <input type="text" placeholder="ArrowRight, Space" ref={(element: Element) => {
							const input = element as HTMLInputElement
							const onInput = (): void => keys.set(input.value)
							input.addEventListener('input', onInput)
							onCleanup(() => input.removeEventListener('input', onInput))
						}} /></label>
					</span>
					<button class="wb-button" type="button" title="Run the script (Ctrl+Enter)" onClick={() => void run()}>▶ Run</button>
					<button class="wb-button" type="button" title="Format document (Ctrl+Shift+I)" onClick={() => current()?.editor.formatDocument()}>Format</button>
					<button class="wb-button" type="button" onClick={requestClose}>Back to editor</button>
				</header>
				<div class="wb-left">
					{() => (
						<nav class="wb-activity" aria-label="Views">
							{(['files', 'search', 'docs'] as const).map((id) => (
								<button
									type="button"
									class="wb-activity-button"
									data-active={String(sidebar() && view() === id)}
									title={id === 'files' ? 'Files' : id === 'search' ? 'Search (Ctrl+Shift+F)' : 'Documentation'}
									ref={(element: Element) => element.append(createIcon(id === 'files' ? 'files' : id === 'search' ? 'search' : 'book', 22))}
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
						!sidebar() ? null : view() === 'search' ? (
							<div class="wb-sidewrap">
								<aside class="wb-side">
									<SearchPanel
										texts={() => collectScripts(props.session.project.assets, new Map([...open.values()].map((item) => [item.id, item.editor.value])))}
										onOpen={(path: string, line: number, character: number) => void openAt(path, line, character)}
										onReplace={(changes: ReadonlyMap<string, string>) => void applyTexts(changes)}
									/>
								</aside>
								<div class="splitter splitter-col wb-handle" ref={(handle: Element) => props.split(handle, 'ideSide', 'x', 1, 180, () => 640)}></div>
							</div>
						) : view() === 'docs' ? (
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
						<div class="wb-panel-tabs">
							{() => {
								tick()
								const count = current()?.diagnostics.length ?? 0
								return (
									<div class="wb-panel-tabs-inner">
										<button type="button" class="wb-panel-tab" data-active={String(panel() === 'problems')} onClick={() => panel.set('problems')}>{`Problems (${count})`}</button>
										<button type="button" class="wb-panel-tab" data-active={String(panel() === 'output')} onClick={() => panel.set('output')}>Output</button>
										<button type="button" class="wb-panel-tab" onClick={() => output.set([])}>Clear</button>
									</div>
								)
							}}
						</div>
						{() => panel() === 'output' ? (<pre class="wb-output">{() => output().join('\n')}</pre>) : (<ul class="script-problems">{() => {
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
						</ul>)}
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
