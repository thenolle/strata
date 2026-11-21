import { StrataError, type Logger } from '@strata/core'
import { Renderer, isRawImage, type Frame, type Texture, type TextureFilter } from './renderer.ts'
import { SPRITE_STRIDE } from './sprite-batch.ts'

const RECOVERY_ATTEMPTS = 3
const RECOVERY_DELAY_MS = 250
const INITIAL_INSTANCE_BYTES = 4096

const SHADER = `
struct Uniforms {
	viewProjection: mat4x4f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(1) @binding(0) var spriteSampler: sampler;
@group(1) @binding(1) var spriteTexture: texture_2d<f32>;

struct SpriteInstance {
	@location(0) center: vec2f,
	@location(1) size: vec2f,
	@location(2) rotation: f32,
	@location(3) uvRect: vec4f,
	@location(4) color: vec4f,
}

struct VertexOutput {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
	@location(1) color: vec4f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32, sprite: SpriteInstance) -> VertexOutput {
	var corners = array<vec2f, 6>(
		vec2f(-0.5, -0.5), vec2f(0.5, -0.5), vec2f(-0.5, 0.5),
		vec2f(-0.5, 0.5), vec2f(0.5, -0.5), vec2f(0.5, 0.5)
	);
	let corner = corners[vertexIndex];
	let offset = corner * sprite.size;
	let cosine = cos(sprite.rotation);
	let sine = sin(sprite.rotation);
	let rotated = vec2f(cosine * offset.x - sine * offset.y, sine * offset.x + cosine * offset.y);
	var result: VertexOutput;
	result.position = uniforms.viewProjection * vec4f(sprite.center + rotated, 0.0, 1.0);
	result.uv = vec2f(
		mix(sprite.uvRect.x, sprite.uvRect.z, corner.x + 0.5),
		mix(sprite.uvRect.w, sprite.uvRect.y, corner.y + 0.5)
	);
	result.color = sprite.color;
	return result;
}

@fragment
fn fragmentMain(vin: VertexOutput) -> @location(0) vec4f {
	return textureSample(spriteTexture, spriteSampler, vin.uv) * vin.color;
}
`

interface GpuState {
	readonly device: GPUDevice
	readonly pipeline: GPURenderPipeline
	readonly textureLayout: GPUBindGroupLayout
	readonly uniformBuffer: GPUBuffer
	readonly uniformGroup: GPUBindGroup
	readonly samplers: Readonly<Record<TextureFilter, GPUSampler>>
	instanceBuffer: GPUBuffer
	instanceCapacity: number
}

interface TextureResources {
	readonly texture: GPUTexture
	readonly bindGroup: GPUBindGroup
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function acquireDevice(): Promise<GPUDevice> {
	if (!('gpu' in navigator)) throw new StrataError('unsupported', 'WebGPU is not available (it needs a supported browser and a secure context)')
	const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
	if (adapter === null) throw new StrataError('unsupported', 'No WebGPU adapter is available')
	return adapter.requestDevice()
}

function buildState(device: GPUDevice, format: GPUTextureFormat): GpuState {
	const module = device.createShaderModule({ code: SHADER })
	const uniformLayout = device.createBindGroupLayout({
		entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }]
	})
	const textureLayout = device.createBindGroupLayout({
		entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }
		]
	})
	const pipeline = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [uniformLayout, textureLayout] }),
		vertex: {
			module,
			entryPoint: 'vertexMain',
			buffers: [
				{
					arrayStride: SPRITE_STRIDE,
					stepMode: 'instance',
					attributes: [
						{ shaderLocation: 0, offset: 0, format: 'float32x2' },
						{ shaderLocation: 1, offset: 8, format: 'float32x2' },
						{ shaderLocation: 2, offset: 16, format: 'float32' },
						{ shaderLocation: 3, offset: 20, format: 'float32x4' },
						{ shaderLocation: 4, offset: 36, format: 'unorm8x4' }
					]
				}
			]
		},
		fragment: {
			module,
			entryPoint: 'fragmentMain',
			targets: [
				{
					format,
					blend: {
						color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
						alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
					}
				}
			]
		},
		primitive: { topology: 'triangle-list' }
	})
	const uniformBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
	const uniformGroup = device.createBindGroup({ layout: uniformLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] })
	const sampler = (filter: GPUFilterMode): GPUSampler =>
		device.createSampler({ magFilter: filter, minFilter: filter, addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })
	return {
		device,
		pipeline,
		textureLayout,
		uniformBuffer,
		uniformGroup,
		samplers: { nearest: sampler('nearest'), linear: sampler('linear') },
		instanceBuffer: device.createBuffer({ size: INITIAL_INSTANCE_BYTES, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }),
		instanceCapacity: INITIAL_INSTANCE_BYTES
	}
}

async function checkedState(device: GPUDevice, format: GPUTextureFormat): Promise<GpuState> {
	device.pushErrorScope('validation')
	const state = buildState(device, format)
	const error = await device.popErrorScope()
	if (error !== null) {
		device.destroy()
		throw new StrataError('graphics-failure', `WebGPU validation failed: ${error.message}`)
	}
	return state
}

/**
 * WebGPU backend. The device and pipelines are built and validated before the canvas is touched,
 * so a failure here leaves the canvas free for the WebGL2 fallback.
 */
export class WebGpuRenderer extends Renderer {
	override readonly backend = 'webgpu' as const
	readonly #context: GPUCanvasContext
	readonly #format: GPUTextureFormat
	readonly #uniformData = new Float32Array(16)
	readonly #textures = new Map<Texture, TextureResources>()
	#gpu: GpuState | undefined
	#simulatingLoss = false
	#recoveryRun = 0

	private constructor(context: GPUCanvasContext, format: GPUTextureFormat, logger: Logger) {
		super(logger)
		this.#context = context
		this.#format = format
	}

	static async create(canvas: HTMLCanvasElement, logger: Logger): Promise<WebGpuRenderer> {
		const device = await acquireDevice()
		const format = navigator.gpu.getPreferredCanvasFormat()
		const state = await checkedState(device, format)
		const context = canvas.getContext('webgpu')
		if (context === null) {
			device.destroy()
			throw new StrataError('unsupported', 'The canvas cannot provide a WebGPU context')
		}
		const renderer = new WebGpuRenderer(context, format, logger)
		renderer.#adopt(device, state)
		return renderer
	}

	override render(frame: Frame): boolean {
		const gpu = this.#gpu
		if (this.status !== 'ready' || gpu === undefined) return false
		const drawable = frame.draws.filter((draw) => draw.batch.count > 0 && this.#textures.has(draw.texture))
		const totalBytes = drawable.reduce((total, draw) => total + draw.batch.byteLength, 0)
		this.#ensureInstanceCapacity(gpu, totalBytes)
		this.#uniformData.set(frame.viewProjection)
		gpu.device.queue.writeBuffer(gpu.uniformBuffer, 0, this.#uniformData)
		const encoder = gpu.device.createCommandEncoder()
		const pass = encoder.beginRenderPass({
			colorAttachments: [{
				view: this.#context.getCurrentTexture().createView(),
				clearValue: { r: frame.clearColor[0], g: frame.clearColor[1], b: frame.clearColor[2], a: frame.clearColor[3] },
				loadOp: 'clear',
				storeOp: 'store'
			}]
		})
		pass.setPipeline(gpu.pipeline)
		pass.setBindGroup(0, gpu.uniformGroup)
		let offset = 0
		for (const draw of drawable) {
			const resources = this.#textures.get(draw.texture)
			if (resources === undefined) continue
			const bytes = draw.batch.byteLength
			gpu.device.queue.writeBuffer(gpu.instanceBuffer, offset, draw.batch.buffer, 0, bytes)
			pass.setBindGroup(1, resources.bindGroup)
			pass.setVertexBuffer(0, gpu.instanceBuffer, offset, bytes)
			pass.draw(6, draw.batch.count)
			offset += bytes
		}
		pass.end()
		gpu.device.queue.submit([encoder.finish()])
		return true
	}

	override simulateLoss(): void {
		const gpu = this.#gpu
		if (gpu === undefined) return
		this.#simulatingLoss = true
		gpu.device.destroy()
	}

	protected override uploadTexture(texture: Texture): void {
		const gpu = this.#gpu
		if (gpu !== undefined) this.#upload(gpu, texture)
	}

	protected override destroyTexture(texture: Texture): void {
		this.#textures.get(texture)?.texture.destroy()
		this.#textures.delete(texture)
	}

	protected override releaseResources(): void {
		const gpu = this.#gpu
		this.#gpu = undefined
		this.#textures.clear()
		this.#recoveryRun++
		this.#context.unconfigure()
		gpu?.device.destroy()
	}

	#adopt(device: GPUDevice, state: GpuState): void {
		this.#context.configure({ device, format: this.#format, alphaMode: 'opaque' })
		this.#gpu = state
		device.onuncapturederror = (event) => {
			this.logger.error('WebGPU error', undefined, { message: event.error.message })
		}
		void device.lost.then((info) => this.#onLost(device, info))
		for (const texture of this.liveTextures) this.#upload(state, texture)
	}

	#upload(gpu: GpuState, texture: Texture): void {
		const { width, height, source, filter } = texture
		const gpuTexture = gpu.device.createTexture({
			size: [width, height],
			format: 'rgba8unorm',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
		})
		if (isRawImage(source)) gpu.device.queue.writeTexture({ texture: gpuTexture }, source.data, { bytesPerRow: width * 4 }, [width, height])
		else gpu.device.queue.copyExternalImageToTexture({ source }, { texture: gpuTexture }, [width, height])
		const bindGroup = gpu.device.createBindGroup({
			layout: gpu.textureLayout,
			entries: [
				{ binding: 0, resource: gpu.samplers[filter] },
				{ binding: 1, resource: gpuTexture.createView() }
			]
		})
		this.#textures.set(texture, { texture: gpuTexture, bindGroup })
	}

	#ensureInstanceCapacity(gpu: GpuState, bytes: number): void {
		if (bytes <= gpu.instanceCapacity) return
		let capacity = gpu.instanceCapacity
		while (capacity < bytes) capacity *= 2
		gpu.instanceBuffer.destroy()
		gpu.instanceBuffer = gpu.device.createBuffer({ size: capacity, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
		gpu.instanceCapacity = capacity
	}

	#onLost(device: GPUDevice, info: GPUDeviceLostInfo): void {
		if (device !== this.#gpu?.device || this.status === 'disposed') return
		if (info.reason === 'destroyed' && !this.#simulatingLoss) return
		this.#simulatingLoss = false
		this.#gpu = undefined
		this.#textures.clear()
		this.setStatus('recovering')
		this.logger.warn('WebGPU device lost', { reason: info.reason, message: info.message })
		this.notify(this.lost, { message: info.message })
		void this.#recover()
	}

	async #recover(): Promise<void> {
		const run = ++this.#recoveryRun
		for (let attempt = 1; attempt <= RECOVERY_ATTEMPTS; attempt++) {
			let device: GPUDevice | undefined
			try {
				device = await acquireDevice()
				const state = await checkedState(device, this.#format)
				if (run !== this.#recoveryRun || this.status !== 'recovering') {
					device.destroy()
					return
				}
				this.#adopt(device, state)
				this.setStatus('ready')
				this.notify(this.restored, undefined)
				return
			} catch (error: unknown) {
				this.#gpu = undefined
				device?.destroy()
				this.logger.warn('WebGPU recovery attempt failed', { attempt, message: error instanceof Error ? error.message : String(error) })
				await delay(RECOVERY_DELAY_MS * attempt)
				if (run !== this.#recoveryRun) return
			}
		}
		this.setStatus('failed')
		this.notify(this.failed, new StrataError('graphics-failure', 'WebGPU device could not be recovered'))
	}
}
