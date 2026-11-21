import { ConsoleSink, Logger } from '@strata/core'
import { Pcg32 } from '@strata/math'
import { Camera2D, SpriteBatch, createRenderer, fitCanvasToDisplay, packColor, type BackendKind, type RawImage } from '@strata/renderer'

const SPRITES = 3000
const WORLD_SIZE = 900

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
	const texture = renderer.createTexture(checkerboard(), 'nearest')
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
	let losses = 0
	let restores = 0
	let frames = 0
	let fps = 0
	let sampleStart = performance.now()
	renderer.lost.subscribe(() => {
		losses++
	})
	renderer.restored.subscribe(() => {
		restores++
	})
	addEventListener('keydown', (event: KeyboardEvent) => {
		if (event.key === 'l' || event.key === 'L') renderer.simulateLoss()
	})
	const frame = (now: number): void => {
		fitCanvasToDisplay(canvas)
		camera.zoom = Math.min(canvas.width, canvas.height) / WORLD_SIZE
		const viewProjection = camera.update(canvas.width, canvas.height)
		batch.clear()
		const time = now / 1000
		for (const sprite of sprites) batch.add(sprite.x, sprite.y, sprite.size, sprite.size, time * sprite.speed, sprite.color)
		renderer.render({ clearColor: [0.06, 0.07, 0.09, 1], viewProjection, draws: [{ texture, batch }] })
		frames++
		if (now - sampleStart >= 500) {
			fps = Math.round((frames * 1000) / (now - sampleStart))
			frames = 0
			sampleStart = now
		}
		hud.textContent = `backend ${renderer.backend}\nstatus ${renderer.status}\nsprites ${SPRITES}\nfps ${fps}\nlosses ${losses}  restores ${restores}\npress L to simulate a graphics loss`
		requestAnimationFrame(frame)
	}
	requestAnimationFrame(frame)
}
