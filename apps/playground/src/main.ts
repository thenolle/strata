import { ConsoleSink, Logger, type Result } from '@strata/core'
import { ActionMap, InputManager, describeBinding } from '@strata/input'
import { Pcg32, Vec2 } from '@strata/math'
import { Project, type AssetRecord, type ImageAsset } from '@strata/project'
import { Camera2D, SpriteBatch, createRenderer, decodeImage, fitCanvasToDisplay, packColor, type BackendKind, type RawImage } from '@strata/renderer'
import { OpfsStorage } from '@strata/storage-opfs'

const SPRITES = 3000
const WORLD_SIZE = 900
const PAN_SPEED = 300
const LISTED_ASSETS = 5

function checkerboard(): RawImage {
	const size = 8
	const data = new Uint8Array(size * size * 4)
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const shade = (x + y) % 2 === 0 ? 255 : 150
			data.set([shade, shade, shade, 255], (y * size + x) * 4)
		}
	}
	return { width: size, height: size, data }
}

function describeAsset(record: AssetRecord): string {
	switch (record.kind) {
		case 'image': return `  ${record.name} (${record.kind}, ${record.image.width}x${record.image.height})`
		case 'audio': return `  ${record.name} (${record.kind}, ${record.audio.durationSeconds.toFixed(2)}s ${record.audio.sampleRate}Hz)`
		case 'script': return `  ${record.name} (${record.kind}, ${record.script.lines} lines)`
		default: throw new Error(`Unknown asset kind: ${String(record.kind)}`)
	}
}

const canvas = document.createElement('canvas')
canvas.style.cssText = 'display:block;width:100vw;height:100vh'
document.body.append(canvas)
const hud = document.createElement('pre')
hud.style.cssText = 'position:fixed;top:8px;left:8px;margin:0;color:#fff;font:12px monospace;text-shadow:0 0 2px #000;pointer-events:none'
document.body.append(hud)

const requested = new URLSearchParams(location.search).get('backend')
const backends: BackendKind[] | undefined = requested === 'webgl2' ? ['webgl2'] : requested === 'webgpu' ? ['webgpu'] : undefined
const logger = new Logger(new ConsoleSink(), 'playground', 'debug')
const created = await createRenderer(canvas, { logger, ...(backends === undefined ? {} : { backends }) })

if (!created.ok) {
	hud.textContent = `Graphics unavailable\n${created.error.message}`
} else {
	const renderer = created.value
	let texture = renderer.createTexture(checkerboard(), 'nearest')
	const batch = new SpriteBatch(SPRITES)
	const camera = new Camera2D()
	const random = new Pcg32(1234)
	const sprites = Array.from({ length: SPRITES }, () => ({
		x: random.range(-WORLD_SIZE / 2, WORLD_SIZE / 2),
		y: random.range(-WORLD_SIZE / 2, WORLD_SIZE / 2),
		size: random.range(6, 28),
		speed: random.range(-2, 2),
		color: packColor(random.range(0.3, 1), random.range(0.3, 1), random.range(0.3, 1), random.range(0.6, 1))
	}))
	const actions = new ActionMap({
		moveLeft: [
			{ kind: 'key', code: 'KeyA' },
			{ kind: 'key', code: 'ArrowLeft' },
			{ kind: 'gamepadAxis', axis: 0, direction: -1 }
		],
		moveRight: [
			{ kind: 'key', code: 'KeyD' },
			{ kind: 'key', code: 'ArrowRight' },
			{ kind: 'gamepadAxis', axis: 0, direction: 1 }
		],
		moveUp: [
			{ kind: 'key', code: 'KeyW' },
			{ kind: 'key', code: 'ArrowUp' },
			{ kind: 'gamepadAxis', axis: 1, direction: -1 }
		],
		moveDown: [
			{ kind: 'key', code: 'KeyS' },
			{ kind: 'key', code: 'ArrowDown' },
			{ kind: 'gamepadAxis', axis: 1, direction: 1 }
		],
		boost: [
			{ kind: 'key', code: 'Space' },
			{ kind: 'pointerButton', button: 0 },
			{ kind: 'gamepadButton', button: 0 }
		],
		resetView: [
			{ kind: 'key', code: 'KeyF' },
			{ kind: 'gamepadButton', button: 3 }
		]
	})
	const input = new InputManager(canvas, actions)
	const move = new Vec2()
	let project: Project | undefined
	let projectLine = 'project: opening'
	let assetLines: string[] = []
	let importLine = 'drop PNG or WAV files onto the page to import them'
	let zoomFactor = 1
	let status = 'WASD or arrows pan, wheel zooms, space or click boosts, F resets, R rebinds boost, L simulates graphics loss'
	let losses = 0
	let restores = 0
	let frames = 0
	let fps = 0
	let sampleStart = performance.now()
	let previous = sampleStart

	const refreshAssets = (): void => {
		const records = project?.assets.list() ?? []
		assetLines = [`assets ${records.length}`, ...records.slice(0, LISTED_ASSETS).map(describeAsset)]
		if (records.length > LISTED_ASSETS) assetLines.push(`  and ${records.length - LISTED_ASSETS} more`)
	}

	const useImage = async (record: ImageAsset): Promise<void> => {
		if (project === undefined) return
		const bytes = await project.assets.read(record.id)
		if (!bytes.ok) {
			importLine = `read failed: ${bytes.error.message}`
			return
		}
		try {
			const next = renderer.createTexture(await decodeImage(bytes.value), 'linear')
			texture.dispose()
			texture = next
		} catch (error: unknown) {
			importLine = `decode failed: ${error instanceof Error ? error.message : String(error)}`
		}
	}

	const openProject = async (): Promise<void> => {
		try {
			const storage = await OpfsStorage.open('playground')
			const opened = await Project.open(storage)
			const result: Result<Project> = opened.ok ? opened : opened.error.code === 'not-found' ? await Project.create(storage, 'Playground') : opened
			if (!result.ok) {
				projectLine = `project error: ${result.error.message}`
				return
			}
			project = result.value
			projectLine = `project ${project.name} (${project.id.slice(0, 8)})`
			refreshAssets()
			const image = project.assets.list().find((record): record is ImageAsset => record.kind === 'image')
			if (image !== undefined) await useImage(image)
		} catch (error: unknown) {
			projectLine = `storage unavailable: ${error instanceof Error ? error.message : String(error)}`
		}
	}

	const importFiles = async (files: readonly File[]): Promise<void> => {
		if (project === undefined) {
			importLine = 'no project is open'
			return
		}
		for (const file of files) {
			const imported = await project.assets.importAsset(file.name, new Uint8Array(await file.arrayBuffer()))
			if (!imported.ok) {
				importLine = `${file.name}: ${imported.error.message}`
				continue
			}
			importLine = `imported ${imported.value.name}`
			void OpfsStorage.requestPersistence()
			refreshAssets()
			if (imported.value.kind === 'image') await useImage(imported.value)
		}
	}

	addEventListener('dragover', (event) => event.preventDefault())
	addEventListener('drop', (event: DragEvent) => {
		event.preventDefault()
		void importFiles([...(event.dataTransfer?.files ?? [])])
	})
	void openProject()

	renderer.lost.subscribe(() => {
		losses++
	})
	renderer.restored.subscribe(() => {
		restores++
	})
	const rebind = async (): Promise<void> => {
		status = 'Press a key or gamepad button for boost (Escape cancels)'
		const binding = await input.captureBinding(AbortSignal.timeout(8000))
		if (binding === undefined) {
			status = 'Rebind cancelled'
			return
		}
		actions.replace('boost', [binding])
		status = `boost is now ${describeBinding(binding)}`
	}
	const frame = (now: number): void => {
		const dt = Math.min(0.1, (now - previous) / 1000)
		previous = now
		input.update()
		if (input.keyboard.wasPressed('KeyL')) renderer.simulateLoss()
		if (input.keyboard.wasPressed('KeyR')) void rebind()
		if (input.action('resetView').pressed) {
			camera.x = 0
			camera.y = 0
			zoomFactor = 1
		}
		zoomFactor = Math.min(8, Math.max(0.25, zoomFactor * Math.exp(-input.wheel * 0.001)))
		input.vector(move, 'moveLeft', 'moveRight', 'moveDown', 'moveUp')
		fitCanvasToDisplay(canvas)
		camera.zoom = (Math.min(canvas.width, canvas.height) / WORLD_SIZE) * zoomFactor
		camera.x += (move.x * PAN_SPEED * dt) / zoomFactor
		camera.y += (move.y * PAN_SPEED * dt) / zoomFactor
		const viewProjection = camera.update(canvas.width, canvas.height)
		const boost = input.action('boost')
		const spin = 1 + 4 * boost.value
		batch.clear()
		const time = now / 1000
		for (const sprite of sprites) batch.add(sprite.x, sprite.y, sprite.size, sprite.size, time * sprite.speed * spin, sprite.color)
		renderer.render({ clearColor: [0.06, 0.07, 0.09, 1], viewProjection, draws: [{ texture, batch }] })
		frames++
		if (now - sampleStart >= 500) {
			fps = Math.round((frames * 1000) / (now - sampleStart))
			frames = 0
			sampleStart = now
		}
		const pad = [...input.gamepads.pads.values()][0]
		const pointer = input.pointers.primary
		hud.textContent = [
			`backend ${renderer.backend}  status ${renderer.status}  fps ${fps}`,
			`losses ${losses}  restores ${restores}`,
			`camera ${camera.x.toFixed(1)}, ${camera.y.toFixed(1)}  zoom ${zoomFactor.toFixed(2)}`,
			`boost ${boost.value.toFixed(2)}  pressed ${boost.pressed}  released ${boost.released}`,
			`pointers ${input.pointers.pointers.size}  primary ${pointer === undefined ? '-' : `${pointer.type} ${Math.round(pointer.x)},${Math.round(pointer.y)}`}`,
			`gamepad ${pad === undefined ? 'none' : `${pad.id} (${pad.mapping || 'unmapped'})`}`,
			projectLine,
			...assetLines,
			importLine,
			status
		].join('\n')
		requestAnimationFrame(frame)
	}
	requestAnimationFrame(frame)
}
