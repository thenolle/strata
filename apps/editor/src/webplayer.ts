import { StrataError, err, ok } from '@strata/core'
import type { AssetRecord } from '@strata/project'
import { Game, type GameAssets } from '@strata/runtime'

interface GameFile {
	readonly scene: string
	readonly assets: readonly AssetRecord[]
	readonly scripts: readonly { readonly id: string; readonly code: string }[]
	/** Present in native builds: every asset as base64, so nothing is fetched. */
	readonly assetData?: Readonly<Record<string, string>>
}

const canvas = document.getElementById('game') as HTMLCanvasElement
const status = document.getElementById('status')

function show(text: string): void {
	if (status !== null) status.textContent = text
}

function decode(base64: string): Uint8Array {
	const text = atob(base64)
	const bytes = new Uint8Array(text.length)
	for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index)
	return bytes
}

async function main(): Promise<void> {
	const inline = document.getElementById('strata-game')
	const data = inline === null ? ((await (await fetch('game.json')).json()) as GameFile) : (JSON.parse(inline.textContent ?? '{}') as GameFile)
	const records = new Map<string, AssetRecord>(data.assets.map((record): [string, AssetRecord] => [record.id, record]))
	const assets: GameAssets = {
		get: (id) => records.get(id),
		read: async (id) => {
			const embedded = data.assetData?.[id]
			if (embedded !== undefined) return ok(decode(embedded))
			try {
				const reply = await fetch(`assets/${encodeURIComponent(id)}`)
				return reply.ok ? ok(new Uint8Array(await reply.arrayBuffer())) : err(new StrataError('not-found', 'No such asset'))
			} catch {
				return err(new StrataError('not-found', 'The asset could not be loaded'))
			}
		}
	}
	const created = await Game.create({
		canvas,
		assets,
		sceneText: data.scene,
		scripts: new Map(data.scripts.map((item): [string, string] => [item.id, item.code])),
		loadModule: (code) => import(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))),
		onError: (text) => show(`Error: ${text}`)
	})
	if (!created.ok) {
		show(created.error.message)
		return
	}
	canvas.focus()
	await created.value.start()
}

void main().catch((error: unknown) => show(error instanceof Error ? error.message : String(error)))
