/** @jsxImportSource @gambrel/view */
import { Button } from '@gambrel/components'
import { onCleanup, signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import type { Guid } from '@strata/core'
import type { EditorSession } from '@strata/editor-core'

/**
 * A plain editor for one script. Save writes it into the project, Check runs the TypeScript compiler on it.
 */
export function ScriptEditor(props: { readonly session: EditorSession; readonly assetId: Guid; readonly onClose: () => void }): Child {
	const record = props.session.project.assets.get(props.assetId)
	const status = signal('Loading')
	const diagnostics = signal('')
	let area: HTMLTextAreaElement | undefined
	let dirty = false

	const save = async (): Promise<void> => {
		if (area === undefined) return
		const result = await props.session.project.assets.replaceScript(props.assetId, new TextEncoder().encode(area.value))
		status.set(result.ok ? 'Saved' : result.error.message)
		if (result.ok) {
			dirty = false
			props.session.notifyAssetsChanged()
		}
	}

	const check = async (): Promise<void> => {
		if (area === undefined) return
		status.set('Checking')
		const response = await fetch('/api/check', { method: 'POST', body: area.value })
		const result = (await response.json()) as { readonly ok: boolean; readonly output: string }
		diagnostics.set(result.ok ? 'No problems found.' : result.output)
		status.set(result.ok ? 'Checked' : 'Problems found')
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
					<Button size="sm" variant="outline" onClick={() => void check().catch((error: unknown) => status.set(String(error)))}>
						Check
					</Button>
					<Button size="sm" onClick={() => void save()}>
						Save
					</Button>
					<Button size="sm" variant="ghost" onClick={close}>
						Close
					</Button>
				</header>
				<textarea
					class="script-area"
					spellcheck={false}
					ref={(element: Element) => {
						const input = element as HTMLTextAreaElement
						area = input
						void props.session.project.assets.read(props.assetId).then((result) => {
							if (!result.ok) {
								status.set(result.error.message)
								return
							}
							input.value = new TextDecoder().decode(result.value)
							status.set('Ready')
							input.focus()
						})
						const onInput = (): void => {
							dirty = true
							status.set('Unsaved changes')
						}
						const onKey = (event: KeyboardEvent): void => {
							if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
								event.preventDefault()
								event.stopPropagation()
								void save()
							} else if (event.key === 'Tab') {
								event.preventDefault()
								input.setRangeText('\t', input.selectionStart, input.selectionEnd, 'end')
								onInput()
							} else if (event.key === 'Escape') {
								event.stopPropagation()
								close()
							}
						}
						input.addEventListener('input', onInput)
						input.addEventListener('keydown', onKey)
						onCleanup(() => {
							input.removeEventListener('input', onInput)
							input.removeEventListener('keydown', onKey)
						})
					}}
				></textarea>
				<pre class="script-diagnostics">{diagnostics}</pre>
			</div>
		</div>
	)
}
