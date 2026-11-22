import type { Entity, Guid, Logger } from '@strata/core'
import { entityIndex } from '@strata/core'
import type { EditorSession } from '@strata/editor-core'
import { ActionMap, InputManager } from '@strata/input'
import { Vec2, Vec3, radToDeg } from '@strata/math'
import { Collider } from '@strata/physics'
import { Camera2D, SpriteBatch, createRenderer, decodeImage, fitCanvasToDisplay, packColor, type Renderer, type Texture } from '@strata/renderer'
import { attachLongPress } from './long-press.ts'

export const ASSET_MIME = 'application/x-strata-asset'

const UNIT = 32
const MIN_ZOOM = 0.05
const MAX_ZOOM = 64
const MAX_GRID_LINES = 60
const STATUS_INTERVAL_MS = 250
const GIZMO_LENGTH = 90
const GIZMO_HANDLE = 7
const RING_SEGMENTS = 48
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
const GIZMO_X = packColor(0.95, 0.3, 0.3, 1)
const GIZMO_Y = packColor(0.3, 0.85, 0.4, 1)
const GIZMO_RING = packColor(1, 0.85, 0.3, 1)
const MIN_SIZE = 4
const RECT_HANDLES: readonly (readonly [number, number])[] = [
	[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]
]

export type Tool = 'move' | 'rotate' | 'scale' | 'rect'
type Handle = 'moveX' | 'moveY' | 'rotate' | 'scaleX' | 'scaleY' | 'rect'

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
	readonly getTool: () => Tool
	readonly onContextMenu: (request: ViewportMenuRequest) => void
	readonly onDropAsset: (drop: AssetDrop) => void
}

interface Drag {
	readonly entity: Entity
	readonly dx: number
	readonly dy: number
}

interface Gizmo {
	readonly handle: Handle
	readonly entity: Entity
	readonly originX: number
	readonly originY: number
	readonly startCursorX: number
	readonly startCursorY: number
	readonly angle: number
	readonly pointerAngle: number
	readonly sx: number
	readonly sy: number
	readonly axisX: number
	readonly axisY: number
	readonly distance: number
	readonly hx: number
	readonly hy: number
	readonly width: number
	readonly height: number
	readonly anchorX: number
	readonly anchorY: number
}

interface SpriteLayer {
	readonly texture: Texture
	readonly batch: SpriteBatch
}

/**
 * Mounts the scene viewport into a host element and returns a function that tears it down.
 * Left click selects, left drag moves, gizmo handles constrain moving, rotating and scaling, middle drag pans,
 * the wheel zooms around the cursor, right click opens the context menu, and image assets dropped from the assets panel become sprites.
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
		const gizmoBatch = new SpriteBatch(128)
		const layers = new Map<string, SpriteLayer>()
		const textures = new Map<string, Texture | null>()
		const cursor = new Vec2()
		const before = new Vec2()
		const dropPoint = new Vec2()
		const probe = new Vec3()
		let drag: Drag | undefined
		let gizmo: Gizmo | undefined
		let lastRect: readonly [number, number] = [0, 0]
		let lastX = 0
		let lastY = 0
		let lastStatus = 0

		const extentOf = (entity: Entity): { readonly w: number; readonly h: number } => {
			const asset = session.spriteOf(entity)
			const record = asset === '' ? undefined : session.project.assets.get(asset as Guid)
			if (record?.kind === 'image') return { w: record.image.width, h: record.image.height }
			const collider = session.world.get(entity, Collider)
			if (collider === undefined) return { w: UNIT, h: UNIT }
			return collider.shape === 'circle' ? { w: collider.radius * 2, h: collider.radius * 2 } : { w: collider.width, h: collider.height }
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

		const frameOf = (entity: Entity): { readonly x: number; readonly y: number; readonly rotation: number } | undefined => {
			const matrix = session.transforms.worldMatrix(entity)
			if (matrix === undefined) return undefined
			return { x: matrix.elements[12] ?? 0, y: matrix.elements[13] ?? 0, rotation: Math.atan2(matrix.elements[1] ?? 0, matrix.elements[0] ?? 0) }
		}

		const hitHandle = (entity: Entity): Handle | undefined => {
			const frame = frameOf(entity)
			if (frame === undefined) return undefined
			const tool = options.getTool()
			const length = GIZMO_LENGTH / camera.zoom
			const reach = (GIZMO_HANDLE * 1.6) / camera.zoom
			const line = 4 / camera.zoom
			const dx = cursor.x - frame.x
			const dy = cursor.y - frame.y
			if (tool === 'rect') {
				const matrix = session.transforms.worldMatrix(entity)
				const extent = extentOf(entity)
				const w = Math.hypot(matrix?.elements[0] ?? 1, matrix?.elements[1] ?? 0) * extent.w
				const h = Math.hypot(matrix?.elements[4] ?? 0, matrix?.elements[5] ?? 1) * extent.h
				const cos = Math.cos(frame.rotation)
				const sin = Math.sin(frame.rotation)
				const localX = dx * cos + dy * sin
				const localY = -dx * sin + dy * cos
				for (const [hx, hy] of RECT_HANDLES) {
					if (Math.abs(localX - (hx * w) / 2) <= reach && Math.abs(localY - (hy * h) / 2) <= reach) {
						lastRect = [hx, hy]
						return 'rect'
					}
				}
				return undefined
			}
			if (tool === 'rotate') return Math.abs(Math.hypot(dx, dy) - length * 0.8) <= reach ? 'rotate' : undefined
			const cos = tool === 'scale' ? Math.cos(frame.rotation) : 1
			const sin = tool === 'scale' ? Math.sin(frame.rotation) : 0
			const along = dx * cos + dy * sin
			const across = -dx * sin + dy * cos
			if (along >= reach && along <= length + reach && Math.abs(across) <= (along > length - reach ? reach : line)) return tool === 'scale' ? 'scaleX' : 'moveX'
			if (across >= reach && across <= length + reach && Math.abs(along) <= (across > length - reach ? reach : line)) return tool === 'scale' ? 'scaleY' : 'moveY'
			return undefined
		}

		const startGizmo = (handle: Handle, entity: Entity): Gizmo | undefined => {
			const frame = frameOf(entity)
			const transform = session.getTransform(entity)
			if (frame === undefined || transform === undefined) return undefined
			const cos = Math.cos(frame.rotation)
			const sin = Math.sin(frame.rotation)
			const dx = cursor.x - frame.x
			const dy = cursor.y - frame.y
			const matrix = session.transforms.worldMatrix(entity)
			const extent = extentOf(entity)
			const rectWidth = Math.hypot(matrix?.elements[0] ?? 1, matrix?.elements[1] ?? 0) * extent.w
			const rectHeight = Math.hypot(matrix?.elements[4] ?? 0, matrix?.elements[5] ?? 1) * extent.h
			const [hx, hy] = lastRect
			return {
				handle,
				entity,
				originX: frame.x,
				originY: frame.y,
				startCursorX: cursor.x,
				startCursorY: cursor.y,
				angle: session.rotationDegrees(entity),
				pointerAngle: Math.atan2(dy, dx),
				sx: transform.sx,
				sy: transform.sy,
				axisX: cos,
				axisY: sin,
				distance: Math.max(1e-3, handle === 'scaleX' ? dx * cos + dy * sin : -dx * sin + dy * cos),
				hx,
				hy,
				width: rectWidth,
				height: rectHeight,
				anchorX: frame.x - hx * (rectWidth / 2) * cos + hy * (rectHeight / 2) * sin,
				anchorY: frame.y - hx * (rectWidth / 2) * sin - hy * (rectHeight / 2) * cos,
			}
		}

		const updateGizmo = (g: Gizmo): void => {
			const dx = cursor.x - g.originX
			const dy = cursor.y - g.originY
			switch (g.handle) {
				case 'moveX':
					session.setWorldPosition(g.entity, g.originX + cursor.x - g.startCursorX, g.originY)
					break
				case 'moveY':
					session.setWorldPosition(g.entity, g.originX, g.originY + cursor.y - g.startCursorY)
					break
				case 'rotate':
					session.setRotationDegrees(g.entity, g.angle + radToDeg(Math.atan2(dy, dx) - g.pointerAngle))
					break
				case 'scaleX':
					session.setTransform(g.entity, { sx: g.sx * Math.max(0.01, (dx * g.axisX + dy * g.axisY) / g.distance) })
					break
				case 'scaleY':
					session.setTransform(g.entity, { sy: g.sy * Math.max(0.01, (-dx * g.axisY + dy * g.axisX) / g.distance) })
					break
				case 'rect': {
					const cos = g.axisX
					const sin = g.axisY
					const px = cursor.x - g.anchorX
					const py = cursor.y - g.anchorY
					const width = g.hx === 0 ? g.width : Math.max(MIN_SIZE, (px * cos + py * sin) * g.hx)
					const height = g.hy === 0 ? g.height : Math.max(MIN_SIZE, (-px * sin + py * cos) * g.hy)
					const centerX = g.anchorX + g.hx * (width / 2) * cos - g.hy * (height / 2) * sin
					const centerY = g.anchorY + g.hx * (width / 2) * sin + g.hy * (height / 2) * cos
					session.setWorldPlacement(g.entity, centerX, centerY, {
						...(g.hx === 0 ? {} : { sx: g.sx * (width / g.width) }),
						...(g.hy === 0 ? {} : { sy: g.sy * (height / g.height) })
					})
					break
				}
			}
		}

		const drawGizmo = (entity: Entity): void => {
			const frame = frameOf(entity)
			if (frame === undefined) return
			const tool = options.getTool()
			const length = GIZMO_LENGTH / camera.zoom
			const thick = 2 / camera.zoom
			const box = (GIZMO_HANDLE * 2) / camera.zoom
			if (tool === 'rect') {
				const matrix = session.transforms.worldMatrix(entity)
				const extent = extentOf(entity)
				const w = Math.hypot(matrix?.elements[0] ?? 1, matrix?.elements[1] ?? 0) * extent.w
				const h = Math.hypot(matrix?.elements[4] ?? 0, matrix?.elements[5] ?? 1) * extent.h
				const cos = Math.cos(frame.rotation)
				const sin = Math.sin(frame.rotation)
				for (const [hx, hy] of RECT_HANDLES) {
					gizmoBatch.add(frame.x + hx * (w / 2) * cos - hy * (h / 2) * sin, frame.y + hx * (w / 2) * sin + hy * (h / 2) * cos, box, box, frame.rotation, GIZMO_RING)
				}
				return
			}
			if (tool === 'rotate') {
				const radius = length * 0.8
				const chord = ((2 * Math.PI * radius) / RING_SEGMENTS) * 1.15
				for (let index = 0; index < RING_SEGMENTS; index++) {
					const angle = (index / RING_SEGMENTS) * Math.PI * 2
					gizmoBatch.add(frame.x + Math.cos(angle) * radius, frame.y + Math.sin(angle) * radius, chord, thick, angle + Math.PI / 2, GIZMO_RING)
				}
				return
			}
			const rotation = tool === 'scale' ? frame.rotation : 0
			const cos = Math.cos(rotation)
			const sin = Math.sin(rotation)
			gizmoBatch.add(frame.x + (cos * length) / 2, frame.y + (sin * length) / 2, length, thick, rotation, GIZMO_X)
			gizmoBatch.add(frame.x + cos * length, frame.y + sin * length, box, box, rotation, GIZMO_X)
			gizmoBatch.add(frame.x - (sin * length) / 2, frame.y + (cos * length) / 2, thick, length, rotation, GIZMO_Y)
			gizmoBatch.add(frame.x - sin * length, frame.y + cos * length, box, box, rotation, GIZMO_Y)
		}

		const openMenuAt = (clientX: number, clientY: number): void => {
			drag = undefined
			gizmo = undefined
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
					const selected = session.selection
					const handle = selected === undefined ? undefined : hitHandle(selected)
					if (selected !== undefined && handle !== undefined) {
						session.select(selected)
						gizmo = startGizmo(handle, selected)
						drag = undefined
					} else {
						gizmo = undefined
						const hit = pick(cursor)
						session.select(hit)
						const matrix = hit === undefined ? undefined : session.transforms.worldMatrix(hit)
						drag = hit === undefined || matrix === undefined ? undefined : { entity: hit, dx: (matrix.elements[12] ?? 0) - cursor.x, dy: (matrix.elements[13] ?? 0) - cursor.y }
					}
				}
				if (buttons.isDown(0)) {
					if (gizmo !== undefined) updateGizmo(gizmo)
					else if (drag !== undefined) session.setWorldPosition(drag.entity, cursor.x + drag.dx, cursor.y + drag.dy)
				}
				lastX = pointer.x
				lastY = pointer.y
			}
			if (buttons.wasReleased(0)) {
				drag = undefined
				gizmo = undefined
			}
			if (manager.keyboard.wasPressed('Delete')) {
				drag = undefined
				gizmo = undefined
				session.deleteSelected()
			}

			const viewProjection = camera.update(width, height)
			grid.clear()
			outlines.clear()
			shapes.clear()
			gizmoBatch.clear()
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
			if (session.selection !== undefined) drawGizmo(session.selection)
			const spriteDraws = [...layers.values()].filter((layer) => layer.batch.count > 0).map((layer) => ({ texture: layer.texture, batch: layer.batch }))
			active.render({
				clearColor: [0.06, 0.07, 0.08, 1],
				viewProjection,
				draws: [{ texture: white, batch: grid }, { texture: white, batch: outlines }, { texture: white, batch: shapes }, ...spriteDraws, { texture: white, batch: gizmoBatch }]
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
