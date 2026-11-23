import type { Renderer } from '@strata/renderer'

export type Shape3D = 'cube' | 'sphere' | 'cylinder' | 'plane' | 'quad'

export interface Draw3D {
	readonly shape: Shape3D
	readonly model: Float32Array
	readonly color: readonly number[]
	readonly lit: boolean
	readonly texture?: WebGLTexture
}

/** One light: `a` is a direction toward the light (w = 0) or a position (w = 1); `b` is color times intensity, then range. */
export interface Light3D {
	readonly a: readonly number[]
	readonly b: readonly number[]
}

type M16 = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]

export function multiply(a: Float32Array, b: Float32Array): Float32Array {
	const out = new Float32Array(16)
	for (let column = 0; column < 4; column++) {
		for (let row = 0; row < 4; row++) {
			let sum = 0
			for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[column * 4 + k]!
			out[column * 4 + row] = sum
		}
	}
	return out
}

export function scaleMatrix(x: number, y: number, z: number): Float32Array {
	return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1])
}

export function invert(m: Float32Array): Float32Array | undefined {
	const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = Array.from(m) as M16
	const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12
	const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32
	let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
	if (Math.abs(det) < 1e-12) return undefined
	det = 1 / det
	return new Float32Array([
		(a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det, (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
		(a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det, (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
		(a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det, (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
		(a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det, (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det
	])
}

const unit = (x: number, y: number, z: number): [number, number, number] => {
	const length = Math.hypot(x, y, z) || 1
	return [x / length, y / length, z / length]
}

/** The view for a camera standing at a world matrix: its position and direction, ignoring any scale. */
export function cameraView(world: Float32Array): Float32Array {
	const right = unit(world[0]!, world[1]!, world[2]!)
	const up = unit(world[4]!, world[5]!, world[6]!)
	const back = unit(world[8]!, world[9]!, world[10]!)
	const [px, py, pz] = [world[12]!, world[13]!, world[14]!]
	const dot = (a: readonly number[]): number => a[0]! * px + a[1]! * py + a[2]! * pz
	return new Float32Array([right[0], up[0], back[0], 0, right[1], up[1], back[1], 0, right[2], up[2], back[2], 0, -dot(right), -dot(up), -dot(back), 1])
}

/** A view from `eye` toward `target`, with y up. */
export function lookAtView(eye: readonly [number, number, number], target: readonly [number, number, number]): Float32Array {
	const back = unit(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2])
	const right = unit(back[2], 0, -back[0])
	const up: [number, number, number] = [back[1] * right[2] - back[2] * right[1], back[2] * right[0] - back[0] * right[2], back[0] * right[1] - back[1] * right[0]]
	const place = new Float32Array([right[0], right[1], right[2], 0, up[0], up[1], up[2], 0, back[0], back[1], back[2], 0, eye[0], eye[1], eye[2], 1])
	return cameraView(place)
}

export function perspective(fovRadians: number, aspect: number, near: number, far: number): Float32Array {
	const f = 1 / Math.tan(fovRadians / 2)
	const out = new Float32Array(16)
	out[0] = f / aspect
	out[5] = f
	out[10] = (far + near) / (near - far)
	out[11] = -1
	out[14] = (2 * far * near) / (near - far)
	return out
}

const VERTEX = `#version 300 es
layout(location = 0) in vec3 p;
layout(location = 1) in vec3 n;
uniform mat4 model;
uniform mat4 viewProj;
uniform mat3 normalMat;
out vec3 wn;
out vec3 wp;
out vec2 uv;
void main() {
	vec4 w = model * vec4(p, 1.0);
	wp = w.xyz;
	wn = normalize(normalMat * n);
	uv = p.xy + 0.5;
	gl_Position = viewProj * w;
}`
const FRAGMENT = `#version 300 es
precision highp float;
in vec3 wn;
in vec3 wp;
in vec2 uv;
uniform vec4 color;
uniform sampler2D tex;
uniform bool useTex;
uniform float lit;
uniform vec4 lightA[4];
uniform vec4 lightB[4];
out vec4 outColor;
void main() {
	vec4 c = useTex ? texture(tex, vec2(uv.x, 1.0 - uv.y)) * color : color;
	if (c.a < 0.01) discard;
	if (lit > 0.5) {
		vec3 n = normalize(wn);
		if (!gl_FrontFacing) n = -n;
		vec3 total = vec3(0.3);
		for (int i = 0; i < 4; i++) {
			vec4 a = lightA[i];
			vec4 b = lightB[i];
			if (a.w < -0.5) continue;
			vec3 l;
			float att = 1.0;
			if (a.w < 0.5) l = normalize(a.xyz);
			else {
				vec3 d = a.xyz - wp;
				float dist = length(d);
				l = d / dist;
				att = clamp(1.0 - dist / max(b.w, 1.0), 0.0, 1.0);
			}
			total += b.rgb * max(dot(n, l), 0.0) * att;
		}
		c.rgb *= min(total, vec3(1.6));
	}
	outColor = c;
}`

const face = (n: readonly number[], u: readonly number[], v: readonly number[]): number[] => {
	const corner = (a: number, b: number): number[] => [0, 1, 2].map((i) => n[i]! * 0.5 + u[i]! * a * 0.5 + v[i]! * b * 0.5)
	return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, -1), corner(1, 1), corner(-1, 1)].flatMap((p) => [...p, ...n])
}
const boxData = (): number[] => [
	...face([0, 0, 1], [1, 0, 0], [0, 1, 0]), ...face([0, 0, -1], [1, 0, 0], [0, 1, 0]), ...face([1, 0, 0], [0, 0, 1], [0, 1, 0]),
	...face([-1, 0, 0], [0, 0, 1], [0, 1, 0]), ...face([0, 1, 0], [1, 0, 0], [0, 0, 1]), ...face([0, -1, 0], [1, 0, 0], [0, 0, 1])
]
const planeData = (): number[] => [-0.5, 0, -0.5, 0, 1, 0, 0.5, 0, -0.5, 0, 1, 0, 0.5, 0, 0.5, 0, 1, 0, -0.5, 0, -0.5, 0, 1, 0, 0.5, 0, 0.5, 0, 1, 0, -0.5, 0, 0.5, 0, 1, 0]
const quadData = (): number[] => [-0.5, -0.5, 0, 0, 0, 1, 0.5, -0.5, 0, 0, 0, 1, 0.5, 0.5, 0, 0, 0, 1, -0.5, -0.5, 0, 0, 0, 1, 0.5, 0.5, 0, 0, 0, 1, -0.5, 0.5, 0, 0, 0, 1]
const sphereData = (): number[] => {
	const out: number[] = []
	const point = (i: number, j: number): number[] => {
		const theta = (i / 14) * Math.PI
		const phi = (j / 24) * Math.PI * 2
		const nx = Math.sin(theta) * Math.cos(phi)
		const ny = Math.cos(theta)
		const nz = Math.sin(theta) * Math.sin(phi)
		return [nx * 0.5, ny * 0.5, nz * 0.5, nx, ny, nz]
	}
	for (let i = 0; i < 14; i++) for (let j = 0; j < 24; j++) out.push(...point(i, j), ...point(i + 1, j), ...point(i + 1, j + 1), ...point(i, j), ...point(i + 1, j + 1), ...point(i, j + 1))
	return out
}
const cylinderData = (): number[] => {
	const out: number[] = []
	const side = (angle: number, y: number): number[] => [Math.cos(angle) * 0.5, y, Math.sin(angle) * 0.5, Math.cos(angle), 0, Math.sin(angle)]
	for (let j = 0; j < 28; j++) {
		const a = (j / 28) * Math.PI * 2
		const b = ((j + 1) / 28) * Math.PI * 2
		out.push(...side(a, -0.5), ...side(b, -0.5), ...side(b, 0.5), ...side(a, -0.5), ...side(b, 0.5), ...side(a, 0.5))
		for (const [y, ny] of [[0.5, 1], [-0.5, -1]] as const) out.push(0, y, 0, 0, ny, 0, Math.cos(a) * 0.5, y, Math.sin(a) * 0.5, 0, ny, 0, Math.cos(b) * 0.5, y, Math.sin(b) * 0.5, 0, ny, 0)
	}
	return out
}

interface Geometry {
	readonly vao: WebGLVertexArrayObject
	readonly count: number
}

function must<T>(value: T | null, what: string): T {
	if (value === null) throw new Error(`WebGL could not create ${what}`)
	return value
}

/**
 * Draws lit meshes and textured cards with perspective on a WebGL 2 canvas. It owns the canvas context, so a game uses it instead of the 2D renderer.
 */
export class Renderer3D {
	readonly #gl: WebGL2RenderingContext
	readonly #program: WebGLProgram
	readonly #geometry: Record<Shape3D, Geometry>
	readonly #uniforms: Record<'model' | 'viewProj' | 'normalMat' | 'color' | 'tex' | 'useTex' | 'lit' | 'lightA' | 'lightB', WebGLUniformLocation | null>

	private constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl
		const compile = (type: number, source: string): WebGLShader => {
			const shader = must(gl.createShader(type), 'a shader')
			gl.shaderSource(shader, source)
			gl.compileShader(shader)
			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'A shader failed to compile')
			return shader
		}
		const program = must(gl.createProgram(), 'a program')
		gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX))
		gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT))
		gl.linkProgram(program)
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'The 3D program failed to link')
		this.#program = program
		const make = (data: readonly number[]): Geometry => {
			const vao = must(gl.createVertexArray(), 'a vertex array')
			gl.bindVertexArray(vao)
			gl.bindBuffer(gl.ARRAY_BUFFER, must(gl.createBuffer(), 'a buffer'))
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW)
			gl.enableVertexAttribArray(0)
			gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0)
			gl.enableVertexAttribArray(1)
			gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12)
			gl.bindVertexArray(null)
			return { vao, count: data.length / 6 }
		}
		this.#geometry = { cube: make(boxData()), sphere: make(sphereData()), cylinder: make(cylinderData()), plane: make(planeData()), quad: make(quadData()) }
		const at = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name)
		this.#uniforms = { model: at('model'), viewProj: at('viewProj'), normalMat: at('normalMat'), color: at('color'), tex: at('tex'), useTex: at('useTex'), lit: at('lit'), lightA: at('lightA'), lightB: at('lightB') }
	}

	/** Returns undefined when the browser cannot give a WebGL 2 context for this canvas. */
	static create(canvas: HTMLCanvasElement): Renderer3D | undefined {
		const gl = canvas.getContext('webgl2', { antialias: true })
		if (gl === null) return undefined
		try {
			return new Renderer3D(gl)
		} catch {
			return undefined
		}
	}

	createTexture(source: Parameters<Renderer['createTexture']>[0]): WebGLTexture {
		const gl = this.#gl
		const texture = must(gl.createTexture(), 'a texture')
		gl.bindTexture(gl.TEXTURE_2D, texture)
		const raw = source as unknown as { readonly width: number; readonly height: number; readonly data?: ArrayBufferView }
		if (raw.data !== undefined) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, raw.width, raw.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, raw.data)
		else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as unknown as ImageBitmap)
		for (const [name, setting] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) gl.texParameteri(gl.TEXTURE_2D, name, setting)
		return texture
	}

	render(view: Float32Array, projection: Float32Array, draws: readonly Draw3D[], lights: readonly Light3D[]): void {
		const gl = this.#gl
		const u = this.#uniforms
		gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
		gl.clearColor(0.06, 0.07, 0.08, 1)
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
		gl.enable(gl.DEPTH_TEST)
		gl.depthFunc(gl.LEQUAL)
		gl.enable(gl.BLEND)
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
		gl.useProgram(this.#program)
		gl.uniformMatrix4fv(u.viewProj, false, multiply(projection, view))
		gl.uniform1i(u.tex, 0)
		const a = new Float32Array(16)
		const b = new Float32Array(16)
		for (let index = 0; index < 4; index++) {
			const light = lights[index]
			a.set(light?.a ?? [0, 0, 0, -1], index * 4)
			b.set(light?.b ?? [0, 0, 0, 0], index * 4)
		}
		if (lights.length === 0) {
			a.set([0.4, 0.8, 0.5, 0], 0)
			b.set([1, 1, 1, 0], 0)
		}
		gl.uniform4fv(u.lightA, a)
		gl.uniform4fv(u.lightB, b)
		for (const textured of [false, true]) {
			for (const item of draws) {
				if ((item.texture !== undefined) !== textured) continue
				const geometry = this.#geometry[item.shape]
				const inverse = invert(item.model)
				const normal = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])
				if (inverse !== undefined) for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) normal[c * 3 + r] = inverse[r * 4 + c]!
				gl.uniformMatrix4fv(u.model, false, item.model)
				gl.uniformMatrix3fv(u.normalMat, false, normal)
				gl.uniform4f(u.color, item.color[0] ?? 1, item.color[1] ?? 1, item.color[2] ?? 1, 1)
				gl.uniform1i(u.useTex, item.texture === undefined ? 0 : 1)
				gl.uniform1f(u.lit, item.lit ? 1 : 0)
				if (item.texture !== undefined) gl.bindTexture(gl.TEXTURE_2D, item.texture)
				gl.bindVertexArray(geometry.vao)
				gl.drawArrays(gl.TRIANGLES, 0, geometry.count)
			}
		}
	}

	dispose(): void {
		this.#gl.getExtension('WEBGL_lose_context')?.loseContext()
	}
}
