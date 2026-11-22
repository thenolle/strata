import { StrataError, err, ok, type Guid } from '@strata/core'
import { Game, type GameAssets } from '@strata/runtime'
import type { FromFrame, FrameAsset, ToFrame } from './play-protocol.ts'

const canvas = document.getElementById('game') as HTMLCanvasElement

function post(message: FromFrame): void {
	window.parent.postMessage(message, '*')
}

function memoryAssets(items: readonly FrameAsset[]): GameAssets {
	const byId = new Map<Guid, FrameAsset>(items.map((item): [Guid, FrameAsset] => [item.record.id, item]))
	return {
		get: (id) => byId.get(id)?.record,
		read: async (id) => {
			const item = byId.get(id)
			return item === undefined ? err(new StrataError('not-found', 'No such asset')) : ok(new Uint8Array(item.bytes))
		}
	}
}

async function begin(message: ToFrame): Promise<void> {
	const created = await Game.create({
		canvas,
		assets: memoryAssets(message.assets),
		sceneText: message.scene,
		scripts: new Map(message.scripts.map((item): [string, string] => [item.id, item.code])),
		loadModule: (code) => import(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))),
		onStatus: (text) => post({ type: 'status', text }),
		onLog: (text) => post({ type: 'log', text }),
		onError: (text) => post({ type: 'error', text })
	})
	if (!created.ok) {
		post({ type: 'error', text: created.error.message })
		return
	}
	canvas.focus()
	await created.value.start()
}

addEventListener('keydown', (event: KeyboardEvent) => {
	if (event.key === 'Escape') post({ type: 'stop' })
})
addEventListener('message', (event: MessageEvent<ToFrame>) => {
	if (event.source !== window.parent || typeof event.data !== 'object' || event.data === null || event.data.type !== 'start') return
	void begin(event.data).catch((error: unknown) => post({ type: 'error', text: error instanceof Error ? error.message : String(error) }))
})
post({ type: 'ready' })
