/** @jsxImportSource @gambrel/view */
import { Button } from '@gambrel/components'
import { onCleanup, signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import type { EditorSession } from '@strata/editor-core'
import { Game } from '@strata/runtime'
import { saveScene } from '@strata/scene'

/**
 * Plays the current scene in its own world, so edits are never affected. Escape or Stop returns to the editor.
 */
export function PlayOverlay(props: { readonly session: EditorSession; readonly onClose: () => void }): Child {
	const message = signal('Starting')
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
			<canvas
				class="play-canvas"
				ref={(element: Element) => {
					const canvas = element as HTMLCanvasElement
					let game: Game | undefined
					let closed = false
					const onKey = (event: KeyboardEvent): void => {
						if (event.key !== 'Escape') return
						event.stopPropagation()
						props.onClose()
					}
					addEventListener('keydown', onKey, true)
					const text = saveScene(props.session.world, props.session.registry)
					if (!text.ok) {
						message.set(text.error.message)
					} else {
						void Game.create({ canvas, assets: props.session.project.assets, sceneText: text.value }).then((result) => {
							if (!result.ok) {
								message.set(result.error.message)
								return
							}
							if (closed) {
								result.value.dispose()
								return
							}
							game = result.value
							message.set('')
							game.start()
						})
					}
					onCleanup(() => {
						closed = true
						removeEventListener('keydown', onKey, true)
						game?.dispose()
					})
				}}
			></canvas>
		</div>
	)
}
