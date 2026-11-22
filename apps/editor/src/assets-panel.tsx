/** @jsxImportSource @gambrel/view */
import { Button } from '@gambrel/components'
import { onCleanup, signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import type { EditorSession } from '@strata/editor-core'
import { ASSET_MIME } from './viewport.ts'

type Asset = ReturnType<EditorSession['project']['assets']['list']>[number]

function uniqueName(session: EditorSession, file: string): string {
	if (session.project.assets.find(file) === undefined) return file
	const dot = file.lastIndexOf('.')
	const stem = dot > 0 ? file.slice(0, dot) : file
	const extension = dot > 0 ? file.slice(dot) : ''
	for (let index = 2; ; index++) {
		const candidate = `${stem} (${index})${extension}`
		if (session.project.assets.find(candidate) === undefined) return candidate
	}
}

function Tile(props: {
	readonly session: EditorSession
	readonly asset: Asset
	readonly run: (command: string, args?: unknown) => void
}): Child {
	const { session, asset } = props
	return (
		<li
			class="tile"
			draggable="true"
			title={asset.name}
			data-menu="assets/context"
			data-asset={asset.id}
			data-kind={asset.kind}
			ref={(element: Element) => {
				const tile = element as HTMLElement
				let url: string | undefined
				let gone = false
				const onDragStart = (event: DragEvent): void => {
					if (event.dataTransfer === null) return
					event.dataTransfer.setData(ASSET_MIME, asset.id)
					event.dataTransfer.effectAllowed = 'copy'
				}
				tile.addEventListener('dragstart', onDragStart)
				const onOpen = (): void => {
					if (asset.kind === 'script') props.run('script.edit', { asset: asset.id })
				}
				tile.addEventListener('dblclick', onOpen)
				if (asset.kind === 'image') {
					void session.project.assets.read(asset.id, false).then((result) => {
						if (!result.ok || gone) return
						url = URL.createObjectURL(new Blob([result.value.slice()], { type: 'image/png' }))
						const image = tile.querySelector('img')
						if (image !== null) image.src = url
					})
				}
				onCleanup(() => {
					gone = true
					tile.removeEventListener('dragstart', onDragStart)
					tile.removeEventListener('dblclick', onOpen)
					if (url !== undefined) URL.revokeObjectURL(url)
				})
			}}
		>
			{asset.kind === 'image' ? <img alt="" draggable="false" /> : <span class="tile-kind">{asset.kind === 'audio' ? 'WAV' : 'TS'}</span>}
			<span class="tile-name">{asset.name}</span>
		</li>
	)
}

/**
 * The project's imported files. Image tiles can be dragged into the viewport or right-clicked for actions.
 */
export function AssetsPanel(props: {
	readonly session: EditorSession
	readonly onNotice: (text: string) => void
	readonly run: (command: string, args?: unknown) => void
}): Child {
	const { session } = props
	const revision = signal(0)
	let picker: HTMLInputElement | undefined

	const importFiles = async (files: readonly File[]): Promise<void> => {
		const problems: string[] = []
		for (const file of files) {
			const result = await session.project.assets.importAsset(uniqueName(session, file.name), new Uint8Array(await file.arrayBuffer()))
			if (!result.ok) problems.push(`${file.name}: ${result.error.message}`)
		}
		revision.update((value) => value + 1)
		session.notifyAssetsChanged()
		props.onNotice(problems.join('; '))
	}

	return (
		<aside class="panel assets" aria-label="Assets">
			<div class="panel-actions">
				<Button size="sm" onClick={() => picker?.click()}>
					Import PNG, WAV or TS
				</Button>
				<Button size="sm" variant="outline" onClick={() => props.run('script.new')}>
					New script
				</Button>
				<input
					type="file"
					accept=".png,.wav,.ts,image/png,audio/wav"
					multiple
					hidden
					ref={(element: Element) => {
						const input = element as HTMLInputElement
						picker = input
						const onChange = (): void => {
							void importFiles([...(input.files ?? [])])
							input.value = ''
						}
						input.addEventListener('change', onChange)
						onCleanup(() => input.removeEventListener('change', onChange))
					}}
				/>
			</div>
			{() => {
				revision()
				const assets = session.project.assets.list()
				if (assets.length === 0) return <p class="panel-empty">No assets yet. Import a PNG to use it as a sprite.</p>
				return <ul class="tiles">{assets.map((asset) => <Tile session={session} asset={asset} run={props.run} />)}</ul>
			}}
		</aside>
	)
}
