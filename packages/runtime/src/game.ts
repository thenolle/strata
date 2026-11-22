import { FixedTimestep, Logger, World, nullSink, type Disposable, type Entity, type Guid, type Result, ok } from '@strata/core'
import { Controller, createGameRegistry, updateControllers, type ControllerInput } from '@strata/gameplay'
import { ActionMap, InputManager } from '@strata/input'
import { Body, Collider, Physics } from '@strata/physics'
import type { GameAssets } from './assets.ts'
import { ScriptHost, ScriptSource, type ComponentView } from '@strata/scripting'
import { Camera2D, SpriteBatch, createRenderer, decodeImage, fitCanvasToDisplay, packColor, type Renderer, type Texture } from '@strata/renderer'
import { Camera, Name, Sprite, Transform, TransformSystem, loadScene } from '@strata/scene'
import { AudioSystem } from './audio.ts'
import { isDrawable } from './visibility.ts'

const UNIT = 32
const GRAVITY = -900
const MAX_FRAME_SECONDS = 0.25
const COLORS = [
	packColor(0.36, 0.62, 0.95),
	packColor(0.45, 0.8, 0.55),
	packColor(0.95, 0.62, 0.3),
	packColor(0.8, 0.5, 0.9),
	packColor(0.95, 0.45, 0.5),
	packColor(0.4, 0.8, 0.85)
]

export interface GameOptions {
	readonly canvas: HTMLCanvasElement
	readonly assets: GameAssets
	readonly sceneText: string
	readonly logger?: Logger
	/** Compiled JavaScript of each script asset, by asset id. */
	readonly scripts?: ReadonlyMap<string, string>
	/** Turns compiled script text into a module. The game never evaluates code itself. */
	readonly loadModule?: (code: string) => Promise<unknown>
	readonly onLog?: (text: string) => void
	readonly onStatus?: (text: string) => void
	readonly onError?: (message: string) => void
}

interface Layer {
	readonly texture: Texture
	readonly batch: SpriteBatch
}

/**
 * Plays a scene: loads it into its own world, runs controllers, physics and transforms at a fixed rate, draws it and plays its audio.
 * It never touches the editor's world, so a play session cannot change the scene being edited.
 */
export class Game implements Disposable {
	readonly world: World
	readonly #options: GameOptions
	readonly #logger: Logger
	readonly #renderer: Renderer
	readonly #transforms: TransformSystem
	readonly #physics: Physics
	readonly #input: InputManager
	readonly #audio: AudioSystem
	readonly #timestep = new FixedTimestep(60)
	readonly #white: Texture
	readonly #shapes = new SpriteBatch(256)
	readonly #layers = new Map<string, Layer>()
	readonly #textures = new Map<string, Texture | null>()
	readonly #camera = new Camera2D()
	readonly #registry = createGameRegistry()
	readonly #scripts: ScriptHost
	#names: Map<string, Entity> | undefined
	#running = false
	#disposed = false
	#frameId = 0
	#last = 0
	#frameSeconds = 0
	#jump = false
	#drawn = 0
	#lastStatus = 0
	#cameraX = 0
	#cameraY = 0
	#cameraReady = false

	readonly #controls: ControllerInput = {
		axisX: () => this.#axis('ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD'),
		axisY: () => this.#axis('ArrowDown', 'KeyS', 'ArrowUp', 'KeyW'),
		consumeJump: () => {
			const requested = this.#jump
			this.#jump = false
			return requested
		}
	}

	private constructor(options: GameOptions, logger: Logger, world: World, renderer: Renderer) {
		this.#options = options
		this.#logger = logger
		this.world = world
		this.#renderer = renderer
		this.#transforms = new TransformSystem(world, logger.child('transforms'))
		this.#physics = new Physics(world, { gravityY: GRAVITY, setPosition: (entity, x, y) => this.#transforms.setLocal(entity, { x, y }) })
		this.#input = new InputManager(options.canvas, new ActionMap())
		this.#audio = new AudioSystem(options.assets, logger.child('audio'))
		const keys = this.#input.keyboard
		this.#scripts = new ScriptHost({
			input: {
				isDown: (code) => keys.isDown(code),
				wasPressed: (code) => keys.wasPressed(code),
				axis: (negative, positive) => (keys.isDown(positive) ? 1 : 0) - (keys.isDown(negative) ? 1 : 0)
			},
			component: (entity, name) => {
				const definition = this.#registry.get(name)
				const data = definition === undefined ? undefined : this.world.get(entity, definition)
				if (name === 'transform' && data !== undefined) this.#transforms.markDirty(entity)
				return data as unknown as ComponentView | undefined
			},
			find: (name) => this.#findByName(name),
			nameOf: (entity) => this.world.get(entity, Name)?.value ?? '',
			setPosition: (entity, x, y) => this.#transforms.setLocal(entity, { x, y }),
			log: (entity, values) => options.onLog?.(`${this.world.get(entity, Name)?.value ?? 'script'}: ${values.map(String).join(' ')}`),
			fail: (entity, hook, error) => {
				const message = error instanceof Error ? error.message : String(error)
				logger.error('Script failed', error)
				options.onError?.(`${this.world.get(entity, Name)?.value ?? 'script'} ${hook}: ${message}`)
			}
		})
		this.#white = renderer.createTexture({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) }, 'nearest')
		this.#transforms.update()
	}

	static async create(options: GameOptions): Promise<Result<Game>> {
		const logger = options.logger ?? new Logger(nullSink, 'game')
		const world = new World()
		const loaded = loadScene(world, createGameRegistry(), options.sceneText)
		if (!loaded.ok) {
			world.dispose()
			return loaded
		}
		const created = await createRenderer(options.canvas, { logger: logger.child('renderer') })
		if (!created.ok) {
			world.dispose()
			return created
		}
		return ok(new Game(options, logger, world, created.value))
	}

	async start(): Promise<void> {
		if (this.#running || this.#disposed) return
		await this.#loadScripts()
		if (this.#running || this.#disposed) return
		this.#running = true
		this.#last = performance.now()
		void this.#audio.start(this.world).catch((error: unknown) => this.#logger.error('Audio failed to start', error))
		this.#frameId = requestAnimationFrame(this.#frame)
	}

	async #loadScripts(): Promise<void> {
		const load = this.#options.loadModule
		const scripts = this.#options.scripts
		if (load === undefined || scripts === undefined) return
		const modules = new Map<string, unknown>()
		for (const entity of this.world.query(ScriptSource)) {
			const asset = this.world.require(entity, ScriptSource).asset
			if (asset === '') continue
			try {
				if (!modules.has(asset)) {
					const code = scripts.get(asset)
					if (code === undefined) throw new Error('The script asset was not found')
					modules.set(asset, ((await load(code)) as { readonly default?: unknown }).default)
				}
				this.#scripts.attach(entity, modules.get(asset))
			} catch (error: unknown) {
				this.#options.onError?.(`Script failed to load: ${error instanceof Error ? error.message : String(error)}`)
			}
		}
	}

	stop(): void {
		this.#running = false
		cancelAnimationFrame(this.#frameId)
	}

	dispose(): void {
		if (this.#disposed) return
		this.stop()
		this.#disposed = true
		this.#scripts.dispose()
		this.#audio.dispose()
		this.#input.dispose()
		this.#renderer.dispose()
		this.#transforms.dispose()
		this.world.dispose()
	}

	#axis(negativeA: string, negativeB: string, positiveA: string, positiveB: string): number {
		const keys = this.#input.keyboard
		return (keys.isDown(positiveA) || keys.isDown(positiveB) ? 1 : 0) - (keys.isDown(negativeA) || keys.isDown(negativeB) ? 1 : 0)
	}

	readonly #frame = (now: number): void => {
		if (!this.#running) return
		const seconds = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - this.#last) / 1000))
		this.#last = now
		this.#frameSeconds = seconds
		this.#input.update()
		const keys = this.#input.keyboard
		if (keys.wasPressed('Space') || keys.wasPressed('ArrowUp') || keys.wasPressed('KeyW')) this.#jump = true
		try {
			this.#timestep.advance(seconds, (step) => {
				updateControllers(this.world, this.#controls)
				this.#scripts.update(step)
				this.#physics.step(step)
				this.#transforms.update()
			})
			this.#draw()
		} catch (error: unknown) {
			this.#logger.error('Game frame failed', error)
			this.#options.onError?.(error instanceof Error ? error.message : String(error))
			this.stop()
			return
		}
		if (now - this.#lastStatus > 250) {
			this.#lastStatus = now
			const bodies = this.world.query(Body).length
			const players = this.world.query(Controller, Body).length
			this.#options.onStatus?.(`${this.#renderer.backend} · ${this.world.entityCount} entities · ${this.#drawn} drawn · ${bodies} bodies · ${players} players · ${this.#scripts.count} scripts`)
		}
		this.#frameId = requestAnimationFrame(this.#frame)
	}

	#extent(entity: Entity): { readonly w: number; readonly h: number } {
		const asset = this.world.get(entity, Sprite)?.asset ?? ''
		const record = asset === '' ? undefined : this.#options.assets.get(asset as Guid)
		if (record?.kind === 'image') return { w: record.image.width, h: record.image.height }
		const collider = this.world.get(entity, Collider)
		if (collider === undefined) return { w: UNIT, h: UNIT }
		return collider.shape === 'circle' ? { w: collider.radius * 2, h: collider.radius * 2 } : { w: collider.width, h: collider.height }
	}

	#textureFor(assetId: string): Texture | undefined {
		const known = this.#textures.get(assetId)
		if (known !== undefined) return known ?? undefined
		this.#textures.set(assetId, null)
		void (async () => {
			const record = this.#options.assets.get(assetId as Guid)
			if (record === undefined || record.kind !== 'image') return
			const bytes = await this.#options.assets.read(record.id)
			if (!bytes.ok || this.#disposed) return
			const bitmap = await decodeImage(bytes.value)
			if (this.#disposed) return
			this.#textures.set(assetId, this.#renderer.createTexture(bitmap, 'nearest'))
		})().catch((error: unknown) => this.#logger.error('Sprite image failed to load', error))
		return undefined
	}

	#findByName(name: string): Entity | undefined {
		if (this.#names === undefined) {
			this.#names = new Map()
			for (const entity of this.world.query(Name)) {
				const value = this.world.require(entity, Name).value
				if (!this.#names.has(value)) this.#names.set(value, entity)
			}
		}
		return this.#names.get(name)
	}

	#updateCamera(): void {
		const view = this.world.query(Camera)[0]
		let targetX = 0
		let targetY = 0
		let zoom = 1
		let smoothing = 0
		if (view !== undefined) {
			const data = this.world.require(view, Camera)
			const own = this.#transforms.worldMatrix(view)
			targetX = own?.elements[12] ?? 0
			targetY = own?.elements[13] ?? 0
			const followed = data.follow === '' ? undefined : this.#findByName(data.follow)
			const target = followed === undefined ? undefined : this.#transforms.worldMatrix(followed)
			if (target !== undefined) {
				targetX = target.elements[12] ?? targetX
				targetY = target.elements[13] ?? targetY
			}
			zoom = Math.max(0.01, data.zoom)
			smoothing = data.smoothing
		}
		if (!this.#cameraReady || smoothing <= 0) {
			this.#cameraX = targetX
			this.#cameraY = targetY
			this.#cameraReady = true
		} else {
			const blend = 1 - Math.exp(-smoothing * this.#frameSeconds)
			this.#cameraX += (targetX - this.#cameraX) * blend
			this.#cameraY += (targetY - this.#cameraY) * blend
		}
		this.#camera.x = this.#cameraX
		this.#camera.y = this.#cameraY
		this.#camera.zoom = zoom
	}

	#draw(): void {
		const canvas = this.#options.canvas
		fitCanvasToDisplay(canvas)
		this.#updateCamera()
		const viewProjection = this.#camera.update(canvas.width, canvas.height)
		this.#shapes.clear()
		for (const layer of this.#layers.values()) layer.batch.clear()
		this.#drawn = 0
		for (const entity of this.world.query(Transform)) {
			if (!isDrawable(this.world, entity)) continue
			this.#drawEntity(entity)
			this.#drawn++
		}
		const spriteDraws = [...this.#layers.values()].filter((layer) => layer.batch.count > 0).map((layer) => ({ texture: layer.texture, batch: layer.batch }))
		this.#renderer.render({
			clearColor: [0.06, 0.07, 0.08, 1],
			viewProjection,
			draws: [{ texture: this.#white, batch: this.#shapes }, ...spriteDraws]
		})
	}

	#drawEntity(entity: Entity): void {
		const matrix = this.#transforms.worldMatrix(entity)
		if (matrix === undefined) return
		const m = matrix.elements
		const extent = this.#extent(entity)
		const x = m[12] ?? 0
		const y = m[13] ?? 0
		const width = Math.hypot(m[0] ?? 0, m[1] ?? 0) * extent.w
		const height = Math.hypot(m[4] ?? 0, m[5] ?? 0) * extent.h
		const rotation = Math.atan2(m[1] ?? 0, m[0] ?? 0)
		const assetId = this.world.get(entity, Sprite)?.asset ?? ''
		const texture = assetId === '' ? undefined : this.#textureFor(assetId)
		if (assetId !== '' && texture !== undefined) {
			let layer = this.#layers.get(assetId)
			if (layer === undefined) {
				layer = { texture, batch: new SpriteBatch(64) }
				this.#layers.set(assetId, layer)
			}
			layer.batch.add(x, y, width, height, rotation, 0xffffffff)
		} else {
			this.#shapes.add(x, y, width, height, rotation, this.world.has(entity, Controller) ? packColor(1, 0.85, 0.3) : (COLORS[entity % COLORS.length] ?? 0xffffffff))
		}
	}
}
