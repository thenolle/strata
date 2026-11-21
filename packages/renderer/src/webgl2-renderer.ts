import { StrataError, type Logger } from '@strata/core'
import { Renderer, isRawImage, type Frame, type Texture } from './renderer.ts'
import { SPRITE_STRIDE } from './sprite-batch.ts'

const INITIAL_INSTANCE_BYTES = 4096
const RESTORE_DELAY_MS = 250

const VERTEX_SOURCE = [
	'#version 300 es',
	'precision highp float;',
	'layout(location = 0) in vec2 aCenter;',
	'layout(location = 1) in vec2 aSize;',
	'layout(location = 2) in float aRotation;',
	'layout(location = 3) in vec4 aUvRect;',
	'layout(location = 4) in vec4 aColor;',
	'uniform mat4 uViewProjection;',
	'out vec2 vUv;',
	'out vec4 vColor;',
	'const vec2 CORNERS[6] = vec2[6](vec2(-0.5, -0.5), vec2(0.5, -0.5), vec2(-0.5, 0.5), vec2(-0.5, 0.5), vec2(0.5, -0.5), vec2(0.5, 0.5));',
	'void main() {',
	'	vec2 corner = CORNERS[gl_VertexID];',
	'	vec2 offset = corner * aSize;',
	'	float c = cos(aRotation);',
	'	float s = sin(aRotation);',
	'	vec2 rotated = vec2(c * offset.x - s * offset.y, s * offset.x + c * offset.y);',
	'	gl_Position = uViewProjection * vec4(aCenter + rotated, 0.0, 1.0);',
	'	vUv = vec2(mix(aUvRect.x, aUvRect.z, corner.x + 0.5), mix(aUvRect.w, aUvRect.y, corner.y + 0.5));',
	'	vColor = aColor;',
	'}'
].join('\n')

const FRAGMENT_SOURCE = [
	'#version 300 es',
	'precision highp float;',
	'uniform sampler2D uTexture;',
	'in vec2 vUv;',
	'in vec4 vColor;',
	'out vec4 outColor;',
	'void main() {',
	'	outColor = texture(uTexture, vUv) * vColor;',
	'}'
].join('\n')

interface GlState {
	readonly program: WebGLProgram
	readonly vao: WebGLVertexArrayObject
	readonly instanceBuffer: WebGLBuffer
	readonly viewProjection: WebGLUniformLocation
	capacity: number
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type)
	if (shader === null) throw new StrataError('graphics-failure', 'Unable to create a shader')
	gl.shaderSource(shader, source)
	gl.compileShader(shader)
	if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
		const log = gl.getShaderInfoLog(shader) ?? ''
		gl.deleteShader(shader)
		throw new StrataError('graphics-failure', `Shader compilation failed: ${log}`)
	}
	return shader
}

function link(gl: WebGL2RenderingContext): WebGLProgram {
	const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE)
	const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE)
	const program = gl.createProgram()
	if (program === null) throw new StrataError('graphics-failure', 'Unable to create a shader program')
	gl.attachShader(program, vertex)
	gl.attachShader(program, fragment)
	gl.linkProgram(program)
	gl.deleteShader(vertex)
	gl.deleteShader(fragment)
	if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
		const log = gl.getProgramInfoLog(program) ?? ''
		gl.deleteProgram(program)
		throw new StrataError('graphics-failure', `Program linking failed: ${log}`)
	}
	return program
}

/**
 * WebGL2 backend and fallback. Loss is handled by preventing the default and rebuilding every resource on restore.
 */
export class WebGl2Renderer extends Renderer {
	override readonly backend = 'webgl2' as const
	readonly #canvas: HTMLCanvasElement
	readonly #gl: WebGL2RenderingContext
	readonly #textures = new Map<Texture, WebGLTexture>()
	#state: GlState | undefined

	readonly #onContextLost = (event: Event): void => {
		event.preventDefault()
		this.#state = undefined
		this.#textures.clear()
		this.setStatus('recovering')
		this.logger.warn('WebGL context lost')
		this.notify(this.lost, { message: 'WebGL context lost' })
	}

	readonly #onContextRestored = (): void => {
		try {
			this.#initialize()
			this.setStatus('ready')
			this.notify(this.restored, undefined)
		} catch (error: unknown) {
			this.setStatus('failed')
			this.notify(this.failed, error instanceof StrataError ? error : new StrataError('graphics-failure', 'WebGL context could not be restored', { cause: error }))
		}
	}

	private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, logger: Logger) {
		super(logger)
		this.#canvas = canvas
		this.#gl = gl
		canvas.addEventListener('webglcontextlost', this.#onContextLost)
		canvas.addEventListener('webglcontextrestored', this.#onContextRestored)
	}

	static create(canvas: HTMLCanvasElement, logger: Logger): WebGl2Renderer {
		const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' })
		if (gl === null) throw new StrataError('unsupported', 'WebGL2 is not available')
		const renderer = new WebGl2Renderer(canvas, gl, logger)
		try {
			renderer.#initialize()
		} catch (error: unknown) {
			renderer.dispose()
			throw error
		}
		return renderer
	}

	override render(frame: Frame): boolean {
		const state = this.#state
		const gl = this.#gl
		if (this.status !== 'ready' || state === undefined || gl.isContextLost()) return false
		const drawable = frame.draws.filter((draw) => draw.batch.count > 0 && this.#textures.has(draw.texture))
		const totalBytes = drawable.reduce((total, draw) => total + draw.batch.byteLength, 0)
		gl.viewport(0, 0, this.#canvas.width, this.#canvas.height)
		gl.clearColor(frame.clearColor[0], frame.clearColor[1], frame.clearColor[2], frame.clearColor[3])
		gl.clear(gl.COLOR_BUFFER_BIT)
		if (drawable.length === 0) return true
		gl.enable(gl.BLEND)
		gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
		gl.useProgram(state.program)
		gl.bindVertexArray(state.vao)
		gl.uniformMatrix4fv(state.viewProjection, false, frame.viewProjection)
		gl.bindBuffer(gl.ARRAY_BUFFER, state.instanceBuffer)
		while (state.capacity < totalBytes) state.capacity *= 2
		gl.bufferData(gl.ARRAY_BUFFER, state.capacity, gl.DYNAMIC_DRAW)
		gl.activeTexture(gl.TEXTURE0)
		let offset = 0
		for (const draw of drawable) {
			const glTexture = this.#textures.get(draw.texture)
			if (glTexture === undefined) continue
			const bytes = draw.batch.byteLength
			gl.bindTexture(gl.TEXTURE_2D, glTexture)
			gl.bufferSubData(gl.ARRAY_BUFFER, offset, new Uint8Array(draw.batch.buffer, 0, bytes))
			this.#pointAttributes(offset)
			gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, draw.batch.count)
			offset += bytes
		}
		return true
	}

	override simulateLoss(): void {
		const extension = this.#gl.getExtension('WEBGL_lose_context')
		if (extension === null || this.#gl.isContextLost()) return
		extension.loseContext()
		setTimeout(() => {
			try {
				extension.restoreContext()
			} catch (error: unknown) {
				this.logger.warn('WebGL restore failed', { message: error instanceof Error ? error.message : String(error) })
			}
		}, RESTORE_DELAY_MS)
	}

	protected override uploadTexture(texture: Texture): void {
		if (this.#state !== undefined) this.#upload(texture)
	}

	protected override destroyTexture(texture: Texture): void {
		const glTexture = this.#textures.get(texture)
		this.#textures.delete(texture)
		if (glTexture !== undefined && !this.#gl.isContextLost()) this.#gl.deleteTexture(glTexture)
	}

	protected override releaseResources(): void {
		const gl = this.#gl
		this.#canvas.removeEventListener('webglcontextlost', this.#onContextLost)
		this.#canvas.removeEventListener('webglcontextrestored', this.#onContextRestored)
		const state = this.#state
		this.#state = undefined
		this.#textures.clear()
		if (state !== undefined && !gl.isContextLost()) {
			gl.deleteProgram(state.program)
			gl.deleteVertexArray(state.vao)
			gl.deleteBuffer(state.instanceBuffer)
		}
		gl.getExtension('WEBGL_lose_context')?.loseContext()
	}

	#initialize(): void {
		const gl = this.#gl
		const program = link(gl)
		const vao = gl.createVertexArray()
		const instanceBuffer = gl.createBuffer()
		const viewProjection = gl.getUniformLocation(program, 'uViewProjection')
		if (vao === null || instanceBuffer === null || viewProjection === null) throw new StrataError('graphics-failure', 'Unable to create WebGL resources')
		gl.bindVertexArray(vao)
		gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer)
		gl.bufferData(gl.ARRAY_BUFFER, INITIAL_INSTANCE_BYTES, gl.DYNAMIC_DRAW)
		for (let attribute = 0; attribute < 5; attribute++) {
			gl.enableVertexAttribArray(attribute)
			gl.vertexAttribDivisor(attribute, 1)
		}
		gl.useProgram(program)
		gl.uniform1i(gl.getUniformLocation(program, 'uTexture'), 0)
		this.#state = { program, vao, instanceBuffer, viewProjection, capacity: INITIAL_INSTANCE_BYTES }
		for (const texture of this.liveTextures) this.#upload(texture)
	}

	#pointAttributes(base: number): void {
		const gl = this.#gl
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, SPRITE_STRIDE, base)
		gl.vertexAttribPointer(1, 2, gl.FLOAT, false, SPRITE_STRIDE, base + 8)
		gl.vertexAttribPointer(2, 1, gl.FLOAT, false, SPRITE_STRIDE, base + 16)
		gl.vertexAttribPointer(3, 4, gl.FLOAT, false, SPRITE_STRIDE, base + 20)
		gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, SPRITE_STRIDE, base + 36)
	}

	#upload(texture: Texture): void {
		const gl = this.#gl
		const { width, height, source, filter } = texture
		const glTexture = gl.createTexture()
		if (glTexture === null) throw new StrataError('graphics-failure', 'Unable to create a texture')
		gl.bindTexture(gl.TEXTURE_2D, glTexture)
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
		if (isRawImage(source)) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data)
		else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source)
		const sampling = filter === 'nearest' ? gl.NEAREST : gl.LINEAR
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, sampling)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, sampling)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		this.#textures.set(texture, glTexture)
	}
}
