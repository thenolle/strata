import { FixedTimestep, Logger, World, nullSink, type Disposable, type Entity, type Guid, type Result, ok, err, StrataError } from '@strata/core'
import { Controller, createGameRegistry, updateControllers, type ControllerInput } from '@strata/gameplay'
import { ActionMap, InputManager, type ControlLayout, type GamepadTracker, attachVirtualControls } from '@strata/input'
import { Body, Collider, Physics } from '@strata/physics'
import type { GameAssets } from './assets.ts'
import { ScriptHost, ScriptSource, type ComponentView } from '@strata/scripting'
import { Camera2D, SpriteBatch, createRenderer, decodeImage, fitCanvasToDisplay, packColor, type Renderer, type Texture } from '@strata/renderer'
import { Camera, Camera3D, Light, Mesh, Name, Sprite, Transform, TransformSystem, loadScene, Environment } from '@strata/scene'
import { Renderer3D, cameraView, lookAtView, multiply, perspective, scaleMatrix, type Draw3D, type Light3D, type Shape3D } from './renderer3d.ts'
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
	/** On-screen controls. Without it there are none. */
	readonly controls?: ControlLayout
	/** Gamepad input as keys. Default true. */
	readonly gamepad?: boolean
}

const PAD_KEYS: readonly { readonly code: string; readonly read: (pads: GamepadTracker) => number }[] = [
	{ code: 'ArrowLeft', read: (pads) => Math.max(pads.axisValue(0, -1), pads.buttonValue(14)) },
	{ code: 'ArrowRight', read: (pads) => Math.max(pads.axisValue(0, 1), pads.buttonValue(15)) },
	{ code: 'ArrowUp', read: (pads) => Math.max(pads.axisValue(1, -1), pads.buttonValue(12)) },
	{ code: 'ArrowDown', read: (pads) => Math.max(pads.axisValue(1, 1), pads.buttonValue(13)) },
	{ code: 'Space', read: (pads) => pads.buttonValue(0) },
	{ code: 'KeyQ', read: (pads) => pads.buttonValue(1) },
	{ code: 'KeyE', read: (pads) => pads.buttonValue(2) },
	{ code: 'KeyR', read: (pads) => pads.buttonValue(3) },
	{ code: 'Enter', read: (pads) => pads.buttonValue(9) }
]

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
	readonly #renderer: Renderer | undefined
	readonly #renderer3d: Renderer3D | undefined
	readonly #transforms: TransformSystem
	readonly #physics: Physics
	readonly #input: InputManager
	readonly #audio: AudioSystem
	readonly #timestep = new FixedTimestep(60)
	readonly #white: Texture | undefined
	readonly #shapes = new SpriteBatch(256)
	readonly #layers = new Map<string, Layer>()
	readonly #textures = new Map<string, Texture | null>()
	readonly #textures3d = new Map<string, WebGLTexture | null>()
	readonly #camera = new Camera2D()
	readonly #registry = createGameRegistry()
	readonly #scripts: ScriptHost
	readonly #padHeld = new Set<string>()
	#detachTouch: (() => void) | undefined
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

	private constructor(options: GameOptions, logger: Logger, world: World, renderer: Renderer | undefined, renderer3d: Renderer3D | undefined) {
		this.#options = options
		this.#logger = logger
		this.world = world
		this.#renderer = renderer
		this.#renderer3d = renderer3d
		this.#transforms = new TransformSystem(world, logger.child('transforms'))
		this.#physics = new Physics(world, { gravityY: GRAVITY, setPosition: (entity, x, y) => this.#transforms.setLocal(entity, { x, y }) })
		this.#input = new InputManager(options.canvas, new ActionMap())
		this.#audio = new AudioSystem(options.assets, logger.child('audio'))
		const keys = this.#input.keyboard
		if (options.controls !== undefined) this.#detachTouch = attachVirtualControls(options.canvas, options.controls, (code, down) => void (down ? keys.press(code) : keys.release(code)))
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
		this.#white = renderer?.createTexture({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) }, 'nearest')
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
		if (world.query(Mesh).length > 0 || world.query(Camera3D).length > 0 || world.query(Light).length > 0 || world.query(Environment).length > 0) {
			const renderer3d = Renderer3D.create(options.canvas)
			if (renderer3d === undefined) {
				world.dispose()
				return err(new StrataError('invalid-argument', 'This scene uses 3D, which needs WebGL 2'))
			}
			return ok(new Game(options, logger, world, undefined, renderer3d))
		}
		const created = await createRenderer(options.canvas, { logger: logger.child('renderer') })
		if (!created.ok) {
			world.dispose()
			return created
		}
		return ok(new Game(options, logger, world, created.value, undefined))
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
		this.#detachTouch?.()
		this.#input.dispose()
		this.#renderer?.dispose()
		this.#renderer3d?.dispose()
		this.#transforms.dispose()
		this.world.dispose()
	}

	#axis(negativeA: string, negativeB: string, positiveA: string, positiveB: string): number {
		const keys = this.#input.keyboard
		return (keys.isDown(positiveA) || keys.isDown(positiveB) ? 1 : 0) - (keys.isDown(negativeA) || keys.isDown(negativeB) ? 1 : 0)
	}

	#bridgePad(): void {
		if (this.#options.gamepad === false) return
		const pads = this.#input.gamepads
		const keys = this.#input.keyboard
		for (const entry of PAD_KEYS) {
			const down = entry.read(pads) >= 0.5
			const held = this.#padHeld.has(entry.code)
			if (down && !held) {
				this.#padHeld.add(entry.code)
				keys.press(entry.code)
			} else if (!down && held) {
				this.#padHeld.delete(entry.code)
				keys.release(entry.code)
			}
		}
	}

	readonly #frame = (now: number): void => {
		if (!this.#running) return
		const seconds = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - this.#last) / 1000))
		this.#last = now
		this.#frameSeconds = seconds
		this.#input.update()
		this.#bridgePad()
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
			const players = this.world.query(Controller).length
			this.#options.onStatus?.(`${this.#renderer?.backend ?? 'webgl2 3d'} · ${this.world.entityCount} entities · ${this.#drawn} drawn · ${bodies} bodies · ${players} players · ${this.#scripts.count} scripts`)
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
			const texture = this.#renderer?.createTexture(bitmap, 'nearest')
			this.#textures.set(assetId, texture ?? null)
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
		if (this.#renderer3d !== undefined) return this.#draw3d(this.#renderer3d)
		const canvas = this.#options.canvas
		fitCanvasToDisplay(canvas)
		this.#updateCamera()
		const viewProjection = this.#camera.update(canvas.width, canvas.height)
		this.#shapes.clear()
		for (const layer of this.#layers.values()) layer.batch.clear()
		this.#drawn = 0
		for (const entity of this.world.query(Transform)) {
			if (!isDrawable(this.world, entity)) continue
			if (this.world.has(entity, Light) || this.world.has(entity, Camera3D)) continue
			this.#drawEntity(entity)
			this.#drawn++
		}
		const spriteDraws = Array.from(this.#layers.values(), (layer) => ({ texture: layer.texture, batch: layer.batch }))
		this.#renderer?.render({
			clearColor: [0.06, 0.07, 0.08, 1],
			viewProjection,
			draws: [{ texture: this.#white as Texture, batch: this.#shapes }, ...spriteDraws]
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

	#textureFor3d(assetId: string, renderer: Renderer3D): WebGLTexture | undefined {
		const known = this.#textures3d.get(assetId)
		if (known !== undefined) return known ?? undefined
		this.#textures3d.set(assetId, null)
		void (async () => {
			const record = this.#options.assets.get(assetId as Guid)
			if (record === undefined || record.kind !== 'image') return
			const bytes = await this.#options.assets.read(record.id)
			if (!bytes.ok || this.#disposed) return
			const bitmap = await decodeImage(bytes.value)
			if (this.#disposed) return
			this.#textures3d.set(assetId, renderer.createTexture(bitmap))
		})().catch((error: unknown) => this.#logger.error('Sprite image failed to load', error))
		return undefined
	}

	#draw3d(renderer: Renderer3D): void {
		const canvas = this.#options.canvas
		fitCanvasToDisplay(canvas)
		this.#drawn = 0
		const draws: Draw3D[] = []
		const lights: Light3D[] = []
		let camera: { readonly world: Float32Array; readonly fov: number; readonly near: number; readonly far: number } | undefined
		const hex = (value: string): number[] => {
			const n = /^#[0-9a-f]{6}$/i.test(value) ? parseInt(value.slice(1), 16) : 0x808080
			return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
		}
		let setting = { background: [0.06, 0.07, 0.08], ambient: 0.3, fog: 0 }
		for (const entity of this.world.query(Transform)) {
			const matrix = this.#transforms.worldMatrix(entity)
			if (matrix === undefined) continue
			const world = Float32Array.from(matrix.elements)
			const view = this.world.get(entity, Camera3D)
			if (view !== undefined) {
				camera ??= { world, fov: view.fov, near: view.near, far: view.far }
				continue
			}
			const atmosphere = this.world.get(entity, Environment)
			if (atmosphere !== undefined) {
				setting = { background: hex(atmosphere.background), ambient: atmosphere.ambient, fog: atmosphere.fog }
				continue
			}
			const light = this.world.get(entity, Light)
			if (light !== undefined) {
				if (lights.length < 4) {
					const tint = hex(light.color)
					const [lx, ly, lz] = [world[8]!, world[9]!, world[10]!]
					const length = Math.hypot(lx, ly, lz) || 1
					const strength = tint.map((channel) => channel * light.intensity)
					lights.push(light.kind === 'point' ? { a: [world[12]!, world[13]!, world[14]!, 1], b: [...strength, light.range] } : { a: [lx / length, ly / length, lz / length, 0], b: [...strength, light.range] })
				}
				continue
			}
			const mesh = this.world.get(entity, Mesh)
			if (mesh !== undefined) {
				const size = mesh.size > 0 ? mesh.size : 100
				const shape: Shape3D = mesh.shape === 'sphere' || mesh.shape === 'cylinder' || mesh.shape === 'plane' ? mesh.shape : 'cube'
				draws.push({ shape, model: multiply(world, scaleMatrix(size, size, size)), color: hex(mesh.color), lit: true })
				this.#drawn++
				continue
			}
			if (!isDrawable(this.world, entity)) continue
			const extent = this.#extent(entity)
			const assetId = this.world.get(entity, Sprite)?.asset ?? ''
			const texture = assetId === '' ? undefined : this.#textureFor3d(assetId, renderer)
			if (texture !== undefined) draws.push({ shape: 'quad', model: multiply(world, scaleMatrix(extent.w, extent.h, 1)), color: [1, 1, 1], lit: false, texture })
			else draws.push({ shape: 'cube', model: multiply(world, scaleMatrix(extent.w, extent.h, 12)), color: [0.36 + (entity % 5) * 0.12, 0.62, 0.95 - (entity % 4) * 0.15], lit: true })
			this.#drawn++
		}
		const aspect = canvas.width / Math.max(1, canvas.height)
		const fov = camera === undefined ? 60 : camera.fov
		const view = camera === undefined ? lookAtView([0, 300, 700], [0, 100, 0]) : cameraView(camera.world)
		const eye: [number, number, number] = camera === undefined ? [0, 300, 700] : [camera.world[12]!, camera.world[13]!, camera.world[14]!]
		renderer.render(view, perspective((fov * Math.PI) / 180, aspect, camera?.near ?? 1, camera?.far ?? 5000), draws, lights, { ...setting, eye })
	}
}
