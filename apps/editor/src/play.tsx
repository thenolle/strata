/** @jsxImportSource @gambrel/view */
import { Button } from '@gambrel/components'
import { onCleanup, signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import type { Guid } from '@strata/core'
import type { EditorSession } from '@strata/editor-core'
import { AudioSource } from '@strata/gameplay'
import { Sprite, saveScene } from '@strata/scene'
import { ScriptSource } from '@strata/scripting'
import { bundleScript, collectScripts, scriptPath } from './ide/bundle-client.ts'
import type { FrameAsset, FromFrame, ToFrame } from './play-protocol.ts'

type Prepared = { readonly ok: true; readonly message: ToFrame; readonly transfer: ArrayBuffer[] } | { readonly ok: false; readonly error: string }

function hint(status: string): string {
	if (status.includes(' 0 drawn')) return `${status} · nothing to draw`
	if (status.includes(' 0 players')) return `${status} · select your entity and click Make player`
	return status
}

/**
 * Copies what the game needs out of the editor: the scene, the assets it uses and its compiled scripts.
 */
async function prepare(session: EditorSession): Promise<Prepared> {
	const text = saveScene(session.world, session.registry)
	if (!text.ok) return { ok: false, error: text.error.message }
	const ids = new Set<string>()
	for (const entity of session.world.query(Sprite)) ids.add(session.world.require(entity, Sprite).asset)
	for (const entity of session.world.query(AudioSource)) ids.add(session.world.require(entity, AudioSource).asset)
	for (const entity of session.world.query(ScriptSource)) ids.add(session.world.require(entity, ScriptSource).asset)
	ids.delete('')
	const assets: FrameAsset[] = []
	const scripts: { id: string; code: string }[] = []
	const transfer: ArrayBuffer[] = []
	let files: Record<string, string> | undefined
	for (const id of ids) {
		const record = session.project.assets.get(id as Guid)
		if (record === undefined) continue
		const bytes = await session.project.assets.read(record.id)
		if (!bytes.ok) return { ok: false, error: bytes.error.message }
		const copy = bytes.value.slice().buffer as ArrayBuffer
		assets.push({ record, bytes: copy })
		transfer.push(copy)
		if (record.kind === 'script') {
			files ??= await collectScripts(session.project.assets)
			const compiled = await bundleScript(files, scriptPath(record))
			if (!compiled.ok) return { ok: false, error: `${record.name}: ${compiled.error}` }
			scripts.push({ id: record.id, code: compiled.code })
		}
	}
	return { ok: true, message: { type: 'start', scene: text.value, assets, scripts }, transfer }
}

/**
 * Plays the current scene in a sandboxed frame with no access to the editor, so neither the game nor its scripts can touch your project.
 * Escape or Stop returns to the editor.
 */
export function PlayOverlay(props: { readonly session: EditorSession; readonly onClose: () => void }): Child {
	const message = signal('Starting')
	const log = signal<readonly string[]>([])
	return (
		<div class="play-backdrop">
			<header class="play-bar">
				<strong>Playing</strong>
				<span>{message}</span>
				<span class="spacer"></span>
				<span>Arrows or WASD to move, Space to jump, Esc to stop</span>
				<Button size="sm" onClick={() => props.onClose()}>
					Stop
				</Button>
			</header>
			<iframe
				class="play-frame"
				title="Game"
				sandbox="allow-scripts"
				allow="autoplay"
				ref={(element: Element) => {
					const frame = element as HTMLIFrameElement
					let closed = false
					if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
					const start = async (): Promise<void> => {
						const prepared = await prepare(props.session)
						if (closed) return
						if (!prepared.ok) {
							message.set(`Cannot start: ${prepared.error}`)
							return
						}
						frame.contentWindow?.postMessage(prepared.message, '*', prepared.transfer)
						frame.focus()
					}
					const onMessage = (event: MessageEvent<FromFrame>): void => {
						if (event.source !== frame.contentWindow || typeof event.data !== 'object' || event.data === null) return
						const data = event.data
						switch (data.type) {
							case 'ready':
								void start().catch((error: unknown) => message.set(`Cannot start: ${error instanceof Error ? error.message : String(error)}`))
								break
							case 'status':
								message.set(hint(data.text))
								break
							case 'log':
								log.update((lines) => [...lines, data.text].slice(-8))
								break
							case 'error':
								message.set(`Error: ${data.text}`)
								break
							case 'stop':
								props.onClose()
								break
						}
					}
					const onKey = (event: KeyboardEvent): void => {
						if (event.key !== 'Escape') return
						event.stopPropagation()
						props.onClose()
					}
					addEventListener('message', onMessage)
					addEventListener('keydown', onKey, true)
					frame.src = '/play/frame.html'
					onCleanup(() => {
						closed = true
						removeEventListener('message', onMessage)
						removeEventListener('keydown', onKey, true)
					})
				}}
			></iframe>
			<pre class="play-log">{() => log().join('\n')}</pre>
		</div>
	)
}
