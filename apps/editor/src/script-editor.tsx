/** @jsxImportSource @gambrel/view */
import { Button } from '@gambrel/components'
import { onCleanup, signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import type { Guid } from '@strata/core'
import type { EditorSession } from '@strata/editor-core'
import { CodeEditor } from './ide/code-editor.ts'
import docs from './ide/docs.txt'
import { ideClient, type Diagnostic } from './ide/ide-client.ts'
import { renderMarkdown } from './ide/markdown.ts'

/**
 * The script IDE: a code editor with highlighting, live errors, suggestions and hover documentation,
 * a docs panel with examples you can insert, and a list of problems.
 */
export function ScriptEditor(props: { readonly session: EditorSession; readonly assetId: Guid; readonly onClose: () => void }): Child {
	const record = props.session.project.assets.get(props.assetId)
	const status = signal('Loading')
	const problems = signal<readonly Diagnostic[]>([])
	const docsOpen = signal(true)
	let editor: CodeEditor | undefined
	let dirty = false
	let closed = false

	const save = async (): Promise<void> => {
		if (editor === undefined) return
		const result = await props.session.project.assets.replaceScript(props.assetId, new TextEncoder().encode(editor.value))
		status.set(result.ok ? 'Saved' : result.error.message)
		if (result.ok) {
			dirty = false
			props.session.notifyAssetsChanged()
		}
	}

	const close = (): void => {
		if (dirty && !confirm('Discard unsaved changes to this script?')) return
		props.onClose()
	}

	return (
		<div class="script-backdrop">
			<div class="script-editor" role="dialog" aria-label="Script editor">
				<header class="script-bar">
					<strong>{record?.name ?? 'Script'}</strong>
					<span class="spacer"></span>
					<span>{status}</span>
					<Button size="sm" variant="outline" onClick={() => docsOpen.update((open) => !open)}>
						Docs
					</Button>
					<Button size="sm" onClick={() => void save()}>
						Save
					</Button>
					<Button size="sm" variant="ghost" onClick={close}>
						Close
					</Button>
				</header>
				<div class="script-main">
					<div
						class="script-host"
						ref={(element: Element) => {
							const host = element as HTMLElement
							void props.session.project.assets.read(props.assetId).then((result) => {
								if (closed) return
								if (!result.ok) {
									status.set(result.error.message)
									return
								}
								const created = new CodeEditor({
									name: props.assetId,
									text: new TextDecoder().decode(result.value),
									client: ideClient,
									onChange: () => {
										dirty = true
										status.set('Unsaved changes')
									},
									onSave: () => void save(),
									onClose: close,
									onDiagnostics: (list) => problems.set(list)
								})
								editor = created
								host.append(created.element)
								created.focus()
								status.set('Ready')
							})
							onCleanup(() => {
								closed = true
								editor?.dispose()
							})
						}}
					></div>
					{() =>
						docsOpen() ? (
							<aside
								class="script-docs"
								ref={(element: Element) => {
									element.append(renderMarkdown(docs, { onInsert: (code) => editor?.insertText(code) }))
								}}
							></aside>
						) : null
					}
				</div>
				<ul class="script-problems">
					{() =>
						problems().length === 0 ? (
							<li class="ok">No problems</li>
						) : (
							problems().map((item) => (
								<li class={item.severity === 1 ? 'error' : 'warning'} onClick={() => editor?.reveal(item.line, item.character)}>
									{`${item.line + 1}:${item.character + 1}  ${item.message}`}
								</li>
							))
						)
					}
				</ul>
			</div>
		</div>
	)
}
