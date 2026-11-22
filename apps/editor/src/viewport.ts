import type { Entity, Guid, Logger } from '@strata/core'
import { entityIndex } from '@strata/core'
import type { EditorSession } from '@strata/editor-core'
import { ActionMap, InputManager } from '@strata/input'
import { Vec2, Vec3 } from '@strata/math'
import { Camera2D, SpriteBatch, createRenderer, decodeImage, fitCanvasToDisplay, packColor, type Renderer, type Texture } from '@strata/renderer'
import { attachLongPress } from './long-press.ts'

export const ASSET_MIME = 'application/x-strata-asset'

const UNIT = 32
const MIN_ZOOM = 0.05
const MAX_ZOOM = 64
const MAX_GRID_LINES = 60
const STATUS_INTERVAL_MS = 250
const ENTITY_COLORS = [
	packColor(0.36, 0.62, 0.95),
	packColor(0.45, 0.8, 0.55),
	packColor(0.95, 0.62, 0.3),
	packColor(0.8, 0.5, 0.9),
	packColor(0.95, 0.45, 0.5),
	packColor(0.4, 0.8, 0.85)
]
const GRID_COLOR = packColor(1, 1, 1, 0.07)
const X_AXIS_COLOR = packColor(0.9, 0.3, 0.3, 0.8)
const Y_AXIS_COLOR = packColor(0.3, 0.8, 0.4, 0.8)
const SELECTION_COLOR = packColor(1, 0.85, 0.3, 1)

/**
 * A request to show the viewport's context menu. `x` and `y` are page coordinates, `world` is the point under the pointer.
 */
export interface ViewportMenuRequest {
	readonly x: number
	readonly y: number
	readonly world: { readonly x: number; readonly y: number }
	readonly entity: Entity | undefined
}

export interface AssetDrop {
	readonly asset: string
	readonly world: { readonly x: number; readonly y: number }
}

export interface ViewportOptions {
	readonly host: HTMLElement
	readonly session: EditorSession
	readonly logger: Logger
	readonly onStatus: (text: string) => void
	readonly isGridVisible: () => boolean
	readonly onContextMenu: (request: ViewportMenuRequest) => void
	readonly onDropAsset: (drop: AssetDrop) => void
}

interface Drag {
	readonly entity: Entity
	readonly dx: number
	readonly dy: number
}

interface SpriteLayer {
	readonly texture: Texture
	readonly batch: SpriteBatch
}

/**
 * Mounts the scene viewport into a host element and returns a function that tears it down.
 * Left click selects, left drag moves, middle drag pans, the wheel zooms around the cursor, right click opens the context menu,
 * and image assets dropped from the assets panel become sprite entities.
 */
export function startViewport(options: ViewportOptions): () => void {
	const { host, session, logger, onStatus } = options
	const canvas = document.createElement('canvas')
	canvas.style.cssText = 'display:block;width:100%;height:100%'
	host.append(canvas)
	let disposed = false
	let frameId = 0
	let renderer: Renderer | undefined
	let input: InputManager | undefined
	let detach: (() => void) | undefined

	const begin = async (): Promise<void> => {
		const created = await createRenderer(canvas, { logger: logger.child('renderer') })
		if (!created.ok) {
			onStatus(`Graphics unavailable: ${created.error.message}`)
			return
		}
		if (disposed) {
			created.value.dispose()
			return
		}
		const active = created.value
		renderer = active
		const manager = new InputManager(canvas, new ActionMap())
		input = manager
		const white = active.createTexture({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) }, 'nearest')
		active.lost.subscribe(() => onStatus('Graphics lost, recovering'))
		active.failed.subscribe((error) => onStatus(error.message))
		const camera = new Camera2D()
		const grid = new SpriteBatch(256)
		const outlines = new SpriteBatch(64)
		const shapes = new SpriteBatch(256)
		const layers = new Map<string, SpriteLayer>()
		const textures = new Map<string, Texture | null>()
		const cursor = new Vec2()
		const before = new Vec2()
		const dropPoint = new Vec2()
		const probe = new Vec3()
		let drag: Drag | undefined
		let lastX = 0
		let lastY = 0
		let lastStatus = 0

		const extentOf = (entity: Entity): { readonly w: number; readonly h: number } => {
			const asset = session.spriteOf(entity)
			const record = asset === '' ? undefined : session.project.assets.get(asset as Guid)
			return record?.kind === 'image' ? { w: record.image.width, h: record.image.height } : { w: UNIT, h: UNIT }
		}

		const textureFor = (assetId: string): Texture | undefined => {
			const known = textures.get(assetId)
			if (known !== undefined) return known ?? undefined
			textures.set(assetId, null)
			void (async () => {
				const record = session.project.assets.get(assetId as Guid)
				if (record === undefined || record.kind !== 'image') return
				const bytes = await session.project.assets.read(record.id)
				if (!bytes.ok || disposed) return
				const bitmap = await decodeImage(bytes.value)
				if (disposed) return
				textures.set(assetId, active.createTexture(bitmap, 'nearest'))
			})().catch((error: unknown) => logger.error('Sprite image failed to load', error))
			return undefined
		}

		const pick = (point: Vec2): Entity | undefined => {
			const rows = session.rows()
			for (let index = rows.length - 1; index >= 0; index--) {
				const row = rows[index]
				const matrix = row === undefined ? undefined : session.transforms.worldMatrix(row.entity)
				if (row === undefined || matrix === undefined) continue
				const inverse = matrix.clone()
				if (!inverse.invert()) continue
				inverse.transformPoint(probe.set(point.x, point.y, 0))
				const extent = extentOf(row.entity)
				if (Math.abs(probe.x) <= extent.w / 2 && Math.abs(probe.y) <= extent.h / 2) return row.entity
			}
			return undefined
		}

		const openMenuAt = (clientX: number, clientY: number): void => {
			drag = undefined
			const hit = pick(cursor)
			session.select(hit)
			options.onContextMenu({ x: clientX, y: clientY, world: { x: cursor.x, y: cursor.y }, entity: hit })
		}
		const onContextMenu = (event: MouseEvent): void => {
			event.preventDefault()
			openMenuAt(event.clientX, event.clientY)
		}
		const onDragOver = (event: DragEvent): void => {
			const transfer = event.dataTransfer
			if (transfer === null || !transfer.types.includes(ASSET_MIME)) return
			event.preventDefault()
			transfer.dropEffect = 'copy'
		}
		const onDrop = (event: DragEvent): void => {
			const asset = event.dataTransfer?.getData(ASSET_MIME)
			if (asset === undefined || asset === '') return
			event.preventDefault()
			const rect = canvas.getBoundingClientRect()
			camera.screenToWorld((event.clientX - rect.left) * (canvas.width / rect.width), (event.clientY - rect.top) * (canvas.height / rect.height), canvas.width, canvas.height, dropPoint)
			options.onDropAsset({ asset, world: { x: dropPoint.x, y: dropPoint.y } })
		}
		canvas.addEventListener('contextmenu', onContextMenu)
		canvas.addEventListener('dragover', onDragOver)
		canvas.addEventListener('drop', onDrop)
		const detachLongPress = attachLongPress(canvas, (_target, x, y) => openMenuAt(x, y))
		detach = () => {
			canvas.removeEventListener('contextmenu', onContextMenu)
			canvas.removeEventListener('dragover', onDragOver)
			canvas.removeEventListener('drop', onDrop)
			detachLongPress()
		}

		const frame = (now: number): void => {
			if (disposed) return
			manager.update()
			session.update()
			fitCanvasToDisplay(canvas)
			const width = canvas.width
			const height = canvas.height
			const buttons = manager.pointers.buttons
			const pointer = manager.pointers.primary
			if (pointer !== undefined) {
				camera.screenToWorld(pointer.x, pointer.y, width, height, cursor)
				if (buttons.isDown(1)) {
					camera.x -= (pointer.x - lastX) / camera.zoom
					camera.y += (pointer.y - lastY) / camera.zoom
					camera.screenToWorld(pointer.x, pointer.y, width, height, cursor)
				}
				if (manager.wheel !== 0) {
					before.copy(cursor)
					camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * Math.exp(-manager.wheel * 0.0015)))
					camera.screenToWorld(pointer.x, pointer.y, width, height, cursor)
					camera.x += before.x - cursor.x
					camera.y += before.y - cursor.y
					camera.screenToWorld(pointer.x, pointer.y, width, height, cursor)
				}
				if (buttons.wasPressed(0)) {
					const hit = pick(cursor)
					session.select(hit)
					const matrix = hit === undefined ? undefined : session.transforms.worldMatrix(hit)
					drag = hit === undefined || matrix === undefined ? undefined : { entity: hit, dx: (matrix.elements[12] ?? 0) - cursor.x, dy: (matrix.elements[13] ?? 0) - cursor.y }
				}
				if (drag !== undefined && buttons.isDown(0)) session.setWorldPosition(drag.entity, cursor.x + drag.dx, cursor.y + drag.dy)
				lastX = pointer.x
				lastY = pointer.y
			}
			if (buttons.wasReleased(0)) drag = undefined
			if (manager.keyboard.wasPressed('Delete')) {
				drag = undefined
				session.deleteSelected()
			}

			const viewProjection = camera.update(width, height)
			grid.clear()
			outlines.clear()
			shapes.clear()
			for (const layer of layers.values()) layer.batch.clear()
			const halfWidth = width / (2 * camera.zoom)
			const halfHeight = height / (2 * camera.zoom)
			const thickness = 1 / camera.zoom
			if (options.isGridVisible()) {
				let step = 64
				while ((Math.max(halfWidth, halfHeight) * 2) / step > MAX_GRID_LINES) step *= 2
				for (let x = Math.floor((camera.x - halfWidth) / step) * step; x <= camera.x + halfWidth; x += step) grid.add(x, camera.y, thickness, halfHeight * 2, 0, GRID_COLOR)
				for (let y = Math.floor((camera.y - halfHeight) / step) * step; y <= camera.y + halfHeight; y += step) grid.add(camera.x, y, halfWidth * 2, thickness, 0, GRID_COLOR)
			}
			grid.add(0, camera.y, thickness * 2, halfHeight * 2, 0, Y_AXIS_COLOR)
			grid.add(camera.x, 0, halfWidth * 2, thickness * 2, 0, X_AXIS_COLOR)
			for (const row of session.rows()) {
				const matrix = session.transforms.worldMatrix(row.entity)
				if (matrix === undefined) continue
				const m = matrix.elements
				const extent = extentOf(row.entity)
				const centerX = m[12] ?? 0
				const centerY = m[13] ?? 0
				const sizeX = Math.hypot(m[0] ?? 0, m[1] ?? 0) * extent.w
				const sizeY = Math.hypot(m[4] ?? 0, m[5] ?? 0) * extent.h
				const rotation = Math.atan2(m[1] ?? 0, m[0] ?? 0)
				if (row.entity === session.selection) outlines.add(centerX, centerY, sizeX + 6 / camera.zoom, sizeY + 6 / camera.zoom, rotation, SELECTION_COLOR)
				const assetId = session.spriteOf(row.entity)
				const texture = assetId === '' ? undefined : textureFor(assetId)
				if (assetId !== '' && texture !== undefined) {
					let layer = layers.get(assetId)
					if (layer === undefined) {
						layer = { texture, batch: new SpriteBatch(64) }
						layers.set(assetId, layer)
					}
					layer.batch.add(centerX, centerY, sizeX, sizeY, rotation, 0xffffffff)
				} else {
					shapes.add(centerX, centerY, sizeX, sizeY, rotation, ENTITY_COLORS[entityIndex(row.entity) % ENTITY_COLORS.length] ?? 0xffffffff)
				}
			}
			const spriteDraws = [...layers.values()].filter((layer) => layer.batch.count > 0).map((layer) => ({ texture: layer.texture, batch: layer.batch }))
			active.render({
				clearColor: [0.06, 0.07, 0.08, 1],
				viewProjection,
				draws: [{ texture: white, batch: grid }, { texture: white, batch: outlines }, { texture: white, batch: shapes }, ...spriteDraws]
			})
			if (now - lastStatus > STATUS_INTERVAL_MS) {
				lastStatus = now
				onStatus(`${active.backend} · ${active.status} · zoom ${camera.zoom.toFixed(2)} · cursor ${cursor.x.toFixed(1)}, ${cursor.y.toFixed(1)} · ${session.world.entityCount} entities`)
			}
			frameId = requestAnimationFrame(frame)
		}
		frameId = requestAnimationFrame(frame)
	}

	void begin().catch((error: unknown) => {
		logger.error('Viewport failed to start', error)
		onStatus(`Viewport failed: ${error instanceof Error ? error.message : String(error)}`)
	})

	return () => {
		disposed = true
		cancelAnimationFrame(frameId)
		detach?.()
		input?.dispose()
		renderer?.dispose()
		canvas.remove()
	}
}
