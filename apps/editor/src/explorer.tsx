/** @jsxImportSource @gambrel/view */
import { effect, onCleanup, signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import type { EditorSession } from '@strata/editor-core'
import { ASSET_MIME } from './viewport.ts'
import { createIcon, type IconName } from './icons.ts'
import { IconButton } from './ui.tsx'

export type Asset = ReturnType<EditorSession['project']['assets']['list']>[number]

interface Row {
	readonly key: string
	readonly kind: 'folder' | 'asset'
	readonly depth: number
	readonly label: string
	readonly folder: string
	readonly asset?: Asset
	readonly open?: boolean
}

const ICON_OF: Readonly<Record<string, IconName>> = { image: 'image', audio: 'audio', script: 'typescript', prefab: 'prefab', graph: 'graph' }

function buildRows(session: EditorSession, expanded: ReadonlySet<string>, kinds: readonly string[] | undefined): Row[] {
	const library = session.project.assets
	const folders = library.folders()
	const assets = library.list().filter((asset) => kinds === undefined || kinds.includes(asset.kind))
	const rows: Row[] = []
	const visit = (parent: string, depth: number): void => {
		for (const folder of folders) {
			const slash = folder.lastIndexOf('/')
			if ((slash < 0 ? '' : folder.slice(0, slash)) !== parent) continue
			const open = expanded.has(folder)
			rows.push({ key: `folder:${folder}`, kind: 'folder', depth, label: folder.slice(slash + 1), folder, open })
			if (open) visit(folder, depth + 1)
		}
		for (const asset of assets) {
			if (asset.folder === parent) rows.push({ key: `asset:${asset.id}`, kind: 'asset', depth, label: asset.name, folder: asset.folder, asset })
		}
	}
	visit('', 0)
	return rows
}

function uniqueName(session: EditorSession, file: string, folder: string): string {
	if (session.project.assets.find(file, folder) === undefined) return file
	const dot = file.lastIndexOf('.')
	const stem = dot > 0 ? file.slice(0, dot) : file
	const extension = dot > 0 ? file.slice(dot) : ''
	for (let index = 2; ; index++) {
		const candidate = `${stem} (${index})${extension}`
		if (session.project.assets.find(candidate, folder) === undefined) return candidate
	}
}

/**
 * The project's files as a tree with folders. Click selects, double click opens, dragging moves files into folders,
 * and F2, Delete and the context menu rename and delete.
 */
export function Explorer(props: {
	readonly session: EditorSession
	readonly run: (command: string, args?: unknown) => void
	readonly onOpen: (asset: Asset) => void
	readonly onNotice: (text: string) => void
	readonly reveal: () => string | undefined
	readonly kinds?: readonly string[]
}): Child {
	const { session } = props
	const expanded = signal<ReadonlySet<string>>(new Set())
	const selected = signal<string | undefined>(undefined)
	const revision = signal(0)
	let current: readonly Row[] = []
	let picker: HTMLInputElement | undefined

	const selectedRow = (): Row | undefined => current.find((row) => row.key === selected.peek())
	const targetFolder = (): string => selectedRow()?.folder ?? ''
	const toggle = (path: string): void => {
		const next = new Set(expanded.peek())
		if (!next.delete(path)) next.add(path)
		expanded.set(next)
	}
	const deleteRow = (row: Row): void => (row.asset === undefined ? props.run('folder.delete', { folder: row.folder }) : props.run('asset.delete', { asset: row.asset.id }))
	const renameRow = (row: Row): void => (row.asset === undefined ? props.run('folder.rename', { folder: row.folder }) : props.run('asset.rename', { asset: row.asset.id }))

	const importFiles = async (files: readonly File[]): Promise<void> => {
		const folder = targetFolder()
		const problems: string[] = []
		for (const file of files) {
			const result = await session.project.assets.importAsset(uniqueName(session, file.name, folder), new Uint8Array(await file.arrayBuffer()), folder)
			if (!result.ok) problems.push(`${file.name}: ${result.error.message}`)
		}
		session.notifyAssetsChanged()
		props.onNotice(problems.join('; '))
	}

	return (
		<aside
			class="panel explorer"
			aria-label="Explorer"
			data-menu="explorer/context"
			data-kind=""
			data-folder=""
			tabindex="0"
			ref={(element: Element) => {
				const root = element as HTMLElement
				const subscription = session.changed.subscribe((kind) => {
					if (kind === 'assets') revision.update((value) => value + 1)
				})
				effect(() => {
					const path = props.reveal()
					if (path === undefined || path === '') return
					const next = new Set(expanded.peek())
					const parts = path.split('/')
					for (let index = 1; index <= parts.length; index++) next.add(parts.slice(0, index).join('/'))
					expanded.set(next)
				})
				const onKeyDown = (event: KeyboardEvent): void => {
					const row = selectedRow()
					const index = current.findIndex((candidate) => candidate.key === selected.peek())
					if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
						const next = current[Math.max(0, Math.min(current.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]
						if (next !== undefined) selected.set(next.key)
					} else if (row !== undefined && event.key === 'ArrowRight' && row.kind === 'folder' && row.open !== true) {
						toggle(row.folder)
					} else if (row !== undefined && event.key === 'ArrowLeft' && row.kind === 'folder' && row.open === true) {
						toggle(row.folder)
					} else if (row !== undefined && event.key === 'Enter') {
						if (row.asset !== undefined) props.onOpen(row.asset)
						else toggle(row.folder)
					} else if (row !== undefined && event.key === 'Delete') {
						deleteRow(row)
					} else if (row !== undefined && event.key === 'F2') {
						renameRow(row)
					} else {
						return
					}
					event.preventDefault()
					event.stopPropagation()
				}
				const onDragOver = (event: DragEvent): void => {
					if (event.dataTransfer?.types.includes(ASSET_MIME) === true) event.preventDefault()
				}
				const onDrop = (event: DragEvent): void => {
					const id = event.dataTransfer?.getData(ASSET_MIME)
					if (id === undefined || id === '') return
					event.preventDefault()
					props.run('asset.move', { asset: id, folder: '' })
				}
				root.addEventListener('keydown', onKeyDown)
				root.addEventListener('dragover', onDragOver)
				root.addEventListener('drop', onDrop)
				onCleanup(() => {
					subscription.dispose()
					root.removeEventListener('keydown', onKeyDown)
					root.removeEventListener('dragover', onDragOver)
					root.removeEventListener('drop', onDrop)
				})
			}}
		>
			<div class="explorer-bar">
				<strong>Explorer</strong>
				<span class="spacer"></span>
				<IconButton icon="new-file" title="New script" onClick={() => props.run('script.new', { folder: targetFolder() })} />
				<IconButton icon="new-folder" title="New folder" onClick={() => props.run('folder.new', { folder: targetFolder() })} />
				<IconButton icon="import" title="Import files" onClick={() => picker?.click()} />
				<IconButton
					icon="trash"
					title="Delete selected"
					onClick={() => {
						const row = selectedRow()
						if (row !== undefined) deleteRow(row)
					}}
				/>
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
				const rows = buildRows(session, expanded(), props.kinds)
				current = rows
				if (rows.length === 0) return <p class="panel-empty">Nothing here yet. Import files or create a folder.</p>
				return (
					<ul class="tree" role="tree">
						{rows.map((row) => (
							<li
								class="tree-row"
								role="treeitem"
								data-menu="explorer/context"
								data-kind={row.asset === undefined ? 'folder' : row.asset.kind}
								data-asset={row.asset?.id ?? null}
								data-folder={row.asset === undefined ? row.folder : null}
								style={`padding-left:${6 + row.depth * 14}px`}
								ref={(element: Element) => {
									const item = element as HTMLElement
									effect(() => {
										item.setAttribute('data-selected', String(selected() === row.key))
									})
									const asset = row.asset
									const onClick = (): void => {
										selected.set(row.key)
										if (asset === undefined) toggle(row.folder)
									}
									item.addEventListener('click', onClick)
									if (asset !== undefined) {
										item.draggable = true
										const onDragStart = (event: DragEvent): void => {
											if (event.dataTransfer === null) return
											event.dataTransfer.setData(ASSET_MIME, asset.id)
											event.dataTransfer.effectAllowed = 'copyMove'
										}
										const onDouble = (): void => props.onOpen(asset)
										item.addEventListener('dragstart', onDragStart)
										item.addEventListener('dblclick', onDouble)
										onCleanup(() => {
											item.removeEventListener('click', onClick)
											item.removeEventListener('dragstart', onDragStart)
											item.removeEventListener('dblclick', onDouble)
										})
									} else {
										const onOver = (event: DragEvent): void => {
											if (event.dataTransfer?.types.includes(ASSET_MIME) !== true) return
											event.preventDefault()
											event.stopPropagation()
										}
										const onDrop = (event: DragEvent): void => {
											const id = event.dataTransfer?.getData(ASSET_MIME)
											if (id === undefined || id === '') return
											event.preventDefault()
											event.stopPropagation()
											props.run('asset.move', { asset: id, folder: row.folder })
										}
										item.addEventListener('dragover', onOver)
										item.addEventListener('drop', onDrop)
										onCleanup(() => {
											item.removeEventListener('click', onClick)
											item.removeEventListener('dragover', onOver)
											item.removeEventListener('drop', onDrop)
										})
									}
								}}
							>
								<span class="tree-chevron" ref={(element: Element) => { if (row.asset === undefined) element.append(createIcon(row.open === true ? 'chevron-down' : 'chevron-right', 12)) }}></span>
								<span class="tree-icon" ref={(element: Element) => { element.append(createIcon(row.asset === undefined ? (row.open === true ? 'folder-open' : 'folder') : (ICON_OF[row.asset.kind] ?? 'file'), 16)) }}></span>
								<span class="tree-label">{row.label}</span>
							</li>
						))}
					</ul>
				)
			}}
		</aside>
	)
}
