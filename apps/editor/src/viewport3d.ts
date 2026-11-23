import type { Entity, Guid } from '@strata/core'
import { Parent, type TransformData } from '@strata/scene'
import { OrbitCamera, closestParam, invert, multiply, project, quatAxisAngle, quatMultiply, rayBox, scaleMatrix, transformPoint, v3, type Quat, type Vec } from './camera3d.ts'
import type { ViewportOptions } from './viewport.ts'

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

const AXES: readonly Vec[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const AXIS_COLORS: readonly (readonly number[])[] = [[0.92, 0.3, 0.3], [0.45, 0.8, 0.35], [0.35, 0.55, 0.95]]
const HOT = [1, 0.85, 0.3]
const PALETTE: readonly (readonly number[])[] = [[0.36, 0.62, 0.95], [0.45, 0.8, 0.55], [0.95, 0.62, 0.3], [0.8, 0.5, 0.9], [0.95, 0.45, 0.5], [0.4, 0.8, 0.85]]
const CORNERS: readonly Vec[] = [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]
const EDGES = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7]
const RING = 48
const SNAP_MOVE = 25
const SNAP_ANGLE = (15 * Math.PI) / 180
const HIT_PIXELS = 10
const GRID_STEP = 50
const GRID_SPAN = 2500

type Kind = 'mesh' | 'shape' | 'sprite' | 'light' | 'camera' | 'empty'
type Tool = 'move' | 'rotate' | 'scale'
interface Item {
	readonly entity: Entity
	readonly kind: Kind
	readonly world: Float32Array
	readonly model: Float32Array
	readonly pickModel: Float32Array
	readonly pickInverse: Float32Array | undefined
	readonly shape: string
	readonly color: readonly number[]
	readonly sprite: string
	readonly fov: number
	readonly position: Vec
}
interface Handle {
	readonly axis: 0 | 1 | 2
	readonly points: readonly Vec[]
}
interface Geometry {
	readonly vao: WebGLVertexArrayObject
	readonly count: number
}
type Drag =
	| { readonly kind: 'camera'; readonly mode: 'orbit' | 'pan'; x: number; y: number }
	| { readonly kind: 'select'; readonly startX: number; readonly startY: number; moved: boolean }
	| { readonly kind: 'gizmo'; readonly tool: Tool; readonly handle: Handle; readonly origin: Vec; readonly s0: number; readonly startX: number; readonly starts: ReadonlyMap<Entity, { readonly position: Vec; readonly rotation: Quat; readonly scale: Vec }> }

function must<T>(value: T | null, what: string): T {
	if (value === null) throw new Error(`WebGL could not create ${what}`)
	return value
}

const arrayBuffer = (value: ArrayLike<number>): Float32Array<ArrayBuffer> => new Float32Array(Array.from(value))

function hex(value: string): readonly number[] {
	const match = /^#([0-9a-f]{6})$/i.exec(value)
	const n = match === null ? 0x808080 : parseInt(match[1] as string, 16)
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function face(n: Vec, u: Vec, v: Vec): number[] {
	const corner = (a: number, b: number): Vec => [n[0] * 0.5 + u[0] * a * 0.5 + v[0] * b * 0.5, n[1] * 0.5 + u[1] * a * 0.5 + v[1] * b * 0.5, n[2] * 0.5 + u[2] * a * 0.5 + v[2] * b * 0.5]
	return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, -1), corner(1, 1), corner(-1, 1)].flatMap((p) => [...p, ...n])
}

const boxData = (): number[] => [
	...face([0, 0, 1], [1, 0, 0], [0, 1, 0]), ...face([0, 0, -1], [1, 0, 0], [0, 1, 0]), ...face([1, 0, 0], [0, 0, 1], [0, 1, 0]),
	...face([-1, 0, 0], [0, 0, 1], [0, 1, 0]), ...face([0, 1, 0], [1, 0, 0], [0, 0, 1]), ...face([0, -1, 0], [1, 0, 0], [0, 0, 1])
]
const planeData = (): number[] => [-0.5, 0, -0.5, 0, 1, 0, 0.5, 0, -0.5, 0, 1, 0, 0.5, 0, 0.5, 0, 1, 0, -0.5, 0, -0.5, 0, 1, 0, 0.5, 0, 0.5, 0, 1, 0, -0.5, 0, 0.5, 0, 1, 0]
const quadData = (): number[] => [-0.5, -0.5, 0, 0, 0, 1, 0.5, -0.5, 0, 0, 0, 1, 0.5, 0.5, 0, 0, 0, 1, -0.5, -0.5, 0, 0, 0, 1, 0.5, 0.5, 0, 0, 0, 1, -0.5, 0.5, 0, 0, 0, 1]

function sphereData(): number[] {
	const out: number[] = []
	const stacks = 14
	const slices = 24
	const point = (i: number, j: number): number[] => {
		const theta = (i / stacks) * Math.PI
		const phi = (j / slices) * Math.PI * 2
		const nx = Math.sin(theta) * Math.cos(phi)
		const ny = Math.cos(theta)
		const nz = Math.sin(theta) * Math.sin(phi)
		return [nx * 0.5, ny * 0.5, nz * 0.5, nx, ny, nz]
	}
	for (let i = 0; i < stacks; i++) for (let j = 0; j < slices; j++) out.push(...point(i, j), ...point(i + 1, j), ...point(i + 1, j + 1), ...point(i, j), ...point(i + 1, j + 1), ...point(i, j + 1))
	return out
}

function cylinderData(): number[] {
	const out: number[] = []
	const slices = 28
	for (let j = 0; j < slices; j++) {
		const a = (j / slices) * Math.PI * 2
		const b = ((j + 1) / slices) * Math.PI * 2
		const side = (angle: number, y: number): number[] => [Math.cos(angle) * 0.5, y, Math.sin(angle) * 0.5, Math.cos(angle), 0, Math.sin(angle)]
		out.push(...side(a, -0.5), ...side(b, -0.5), ...side(b, 0.5), ...side(a, -0.5), ...side(b, 0.5), ...side(a, 0.5))
		for (const [y, ny] of [[0.5, 1], [-0.5, -1]] as const) out.push(0, y, 0, 0, ny, 0, Math.cos(a) * 0.5, y, Math.sin(a) * 0.5, 0, ny, 0, Math.cos(b) * 0.5, y, Math.sin(b) * 0.5, 0, ny, 0)
	}
	return out
}

/**
 * The 3D editor view: lit meshes, lights and cameras as nodes, a ground grid, move, rotate and scale gizmos, orbit and picking.
 * Entities from 2D scenes appear as flat cards standing in the scene.
 */
export function startViewport3D(options: ViewportOptions): () => void {
	const { host, session } = options
	if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
	const toolbar = host.querySelector<HTMLElement>('.viewport-toolbar')
	if (toolbar !== null) {
		if (getComputedStyle(toolbar).position === 'static') toolbar.style.position = 'relative'
		toolbar.style.zIndex = '6'
	}
	const canvas = document.createElement('canvas')
	canvas.tabIndex = 0
	canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:none;z-index:0'
	host.prepend(canvas)
	const gl = canvas.getContext('webgl2', { antialias: true })
	if (gl === null) {
		options.onStatus('The 3D view needs WebGL 2, which this browser does not offer')
		return () => canvas.remove()
	}

	const camera = new OrbitCamera()
	camera.yaw = 0.6
	camera.pitch = 0.4
	camera.distance = 900
	camera.target = [0, 100, 0]
	const textures = new Map<string, WebGLTexture | null>()
	let items: readonly Item[] = []
	let lightA = new Float32Array(16)
	let lightB = new Float32Array(16)
	let viewProj = new Float32Array(16)
	let dirty = true
	let stopped = false
	let snap = false
	let hover: Handle | undefined
	let drag: Drag | undefined
	let lastGrid = options.isGridVisible()
	let lastTool = options.getTool()
	let frameId = 0

	let program: WebGLProgram
	let geo: Record<'box' | 'sphere' | 'cylinder' | 'plane' | 'quad' | 'gridMinor' | 'gridMajor' | 'axisX' | 'axisY' | 'axisZ', Geometry>
	let u: Record<'model' | 'viewProj' | 'normalMat' | 'color' | 'tex' | 'useTex' | 'lit' | 'lightA' | 'lightB', WebGLUniformLocation | null>
	try {
		const compile = (type: number, source: string): WebGLShader => {
			const shader = must(gl.createShader(type), 'a shader')
			gl.shaderSource(shader, source)
			gl.compileShader(shader)
			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'A shader failed to compile')
			return shader
		}
		program = must(gl.createProgram(), 'a program')
		gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX))
		gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT))
		gl.linkProgram(program)
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'The 3D program failed to link')
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
		const lines = (pairs: readonly number[][]): number[] => pairs.flatMap((p) => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, 0, 1, 0])
		const minor: number[][] = []
		const major: number[][] = []
		for (let step = -GRID_SPAN; step <= GRID_SPAN; step += GRID_STEP) {
			const target = step % (GRID_STEP * 5) === 0 ? major : minor
			target.push([step, 0, -GRID_SPAN], [step, 0, GRID_SPAN], [-GRID_SPAN, 0, step], [GRID_SPAN, 0, step])
		}
		geo = {
			box: make(boxData()), sphere: make(sphereData()), cylinder: make(cylinderData()), plane: make(planeData()), quad: make(quadData()),
			gridMinor: make(lines(minor)), gridMajor: make(lines(major)),
			axisX: make(lines([[-GRID_SPAN, 0, 0], [GRID_SPAN, 0, 0]])), axisY: make(lines([[0, 0, 0], [0, GRID_SPAN, 0]])), axisZ: make(lines([[0, 0, -GRID_SPAN], [0, 0, GRID_SPAN]]))
		}
		u = {
			model: gl.getUniformLocation(program, 'model'), viewProj: gl.getUniformLocation(program, 'viewProj'), normalMat: gl.getUniformLocation(program, 'normalMat'), color: gl.getUniformLocation(program, 'color'),
			tex: gl.getUniformLocation(program, 'tex'), useTex: gl.getUniformLocation(program, 'useTex'), lit: gl.getUniformLocation(program, 'lit'), lightA: gl.getUniformLocation(program, 'lightA'), lightB: gl.getUniformLocation(program, 'lightB')
		}
	} catch (error: unknown) {
		options.onStatus(`The 3D view could not start: ${error instanceof Error ? error.message : String(error)}`)
		return () => canvas.remove()
	}

	const definitions = new Map([...session.registry.definitions()].map((definition) => [definition.name, definition]))
	const has = (entity: Entity, name: string): boolean => {
		const definition = definitions.get(name)
		return definition !== undefined && session.world.has(entity, definition)
	}
	const value = (entity: Entity, name: string, field: string): unknown => {
		const definition = definitions.get(name)
		return definition === undefined ? undefined : session.componentValue(entity, definition, field)
	}
	const textureFor = (assetId: string): WebGLTexture | undefined => {
		const known = textures.get(assetId)
		if (known !== undefined) return known ?? undefined
		textures.set(assetId, null)
		void (async () => {
			const bytes = await session.project.assets.read(assetId as Guid)
			if (!bytes.ok || stopped) return
			const bitmap = await createImageBitmap(new Blob([bytes.value.slice().buffer as ArrayBuffer]))
			if (stopped) return
			const texture = must(gl.createTexture(), 'a texture')
			gl.bindTexture(gl.TEXTURE_2D, texture)
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
			for (const [name, setting] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) gl.texParameteri(gl.TEXTURE_2D, name, setting)
			textures.set(assetId, texture)
			dirty = true
		})().catch(() => undefined)
		return undefined
	}

	const collect = (): void => {
		session.update()
		const next: Item[] = []
		const lights: { a: number[]; b: number[] }[] = []
		for (const row of session.rows()) {
			const worldMatrix = session.transforms.worldMatrix(row.entity)
			if (worldMatrix === undefined) continue
			const world = Float32Array.from(worldMatrix.elements)
			const entity = row.entity
			let kind: Kind = 'empty'
			let shape = 'cube'
			let color: readonly number[] = PALETTE[entity % PALETTE.length] ?? [1, 1, 1]
			let draw: Vec = [28, 28, 28]
			let pick: Vec = [28, 28, 28]
			let sprite = ''
			let fov = 60
			if (has(entity, 'mesh')) {
				kind = 'mesh'
				shape = String(value(entity, 'mesh', 'shape') ?? 'cube')
				color = hex(String(value(entity, 'mesh', 'color') ?? '#808080'))
				const size = Number(value(entity, 'mesh', 'size')) || 100
				draw = [size, size, size]
				pick = shape === 'plane' ? [size, 6, size] : draw
			} else if (has(entity, 'light')) {
				kind = 'light'
				const point = value(entity, 'light', 'kind') === 'point'
				const tint = hex(String(value(entity, 'light', 'color') ?? '#ffffff'))
				const intensity = Number(value(entity, 'light', 'intensity') ?? 1)
				const range = Number(value(entity, 'light', 'range') ?? 500)
				color = [1, 0.9, 0.4]
				if (lights.length < 4) {
					const toward = v3.normalize([world[8]!, world[9]!, world[10]!])
					lights.push({ a: point ? [world[12]!, world[13]!, world[14]!, 1] : [toward[0], toward[1], toward[2], 0], b: [tint[0]! * intensity, tint[1]! * intensity, tint[2]! * intensity, range] })
				}
			} else if (has(entity, 'camera3d')) {
				kind = 'camera'
				fov = Number(value(entity, 'camera3d', 'fov') ?? 60)
			} else {
				const id = session.spriteOf(entity)
				const record = id === '' ? undefined : session.project.assets.get(id as Guid)
				if (record?.kind === 'image') {
					kind = 'sprite'
					sprite = id
					draw = [record.image.width, record.image.height, 1]
					pick = [record.image.width, record.image.height, 8]
				} else if (has(entity, 'collider')) {
					kind = 'shape'
					const circle = value(entity, 'collider', 'shape') === 'circle'
					const w = circle ? Number(value(entity, 'collider', 'radius') ?? 16) * 2 : Number(value(entity, 'collider', 'width') ?? 32)
					const h = circle ? w : Number(value(entity, 'collider', 'height') ?? 32)
					draw = [w, h, 12]
					pick = draw
				}
			}
			const model = multiply(world, scaleMatrix(...draw))
			const pickModel = multiply(world, scaleMatrix(...pick))
			next.push({ entity, kind, world, model, pickModel, pickInverse: invert(pickModel), shape, color, sprite, fov, position: [world[12]!, world[13]!, world[14]!] })
		}
		if (lights.length === 0) lights.push({ a: [0.4, 0.8, 0.5, 0], b: [1, 1, 1, 0] })
		lightA = new Float32Array(16).fill(0)
		lightB = new Float32Array(16).fill(0)
		for (let index = 0; index < 4; index++) {
			const light = lights[index]
			lightA.set(light === undefined ? [0, 0, 0, -1] : light.a, index * 4)
			lightB.set(light === undefined ? [0, 0, 0, 0] : light.b, index * 4)
		}
		items = next
	}

	const normalMatrix = (model: Float32Array): Float32Array => {
		const inverse = invert(model)
		const out = new Float32Array(9)
		if (inverse === undefined) return out.fill(0).map((_, index) => (index % 4 === 0 ? 1 : 0))
		for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) out[c * 3 + r] = inverse[r * 4 + c]!
		return out
	}
	const draw = (geometry: Geometry, mode: number, model: Float32Array, color: readonly number[], lit: number, texture?: WebGLTexture): void => {
		gl.uniformMatrix4fv(u.model, false, model)
		gl.uniformMatrix3fv(u.normalMat, false, normalMatrix(model))
		gl.uniform4f(u.color, color[0] ?? 1, color[1] ?? 1, color[2] ?? 1, color[3] ?? 1)
		gl.uniform1i(u.useTex, texture === undefined ? 0 : 1)
		gl.uniform1f(u.lit, lit)
		if (texture !== undefined) gl.bindTexture(gl.TEXTURE_2D, texture)
		gl.bindVertexArray(geometry.vao)
		gl.drawArrays(mode, 0, geometry.count)
	}
	const bar = (a: Vec, b: Vec, thickness: number, color: readonly number[]): void => {
		const d = v3.sub(b, a)
		const length = v3.length(d)
		if (length < 1e-4) return
		const x = v3.scale(d, 1 / length)
		const helper: Vec = Math.abs(x[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0]
		const z = v3.normalize(v3.cross(x, helper))
		const y = v3.cross(z, x)
		const mid = v3.scale(v3.add(a, b), 0.5)
		draw(geo.box, gl.TRIANGLES, new Float32Array([x[0] * length, x[1] * length, x[2] * length, 0, y[0] * thickness, y[1] * thickness, y[2] * thickness, 0, z[0] * thickness, z[1] * thickness, z[2] * thickness, 0, mid[0], mid[1], mid[2], 1]), color, 0)
	}

	const primary = (): Item | undefined => items.find((item) => item.entity === session.selection)
	const activeTool = (): Tool => {
		const tool = options.getTool()
		return tool === 'rotate' ? 'rotate' : tool === 'scale' ? 'scale' : 'move'
	}
	const gizmoSize = (origin: Vec): number => v3.length(v3.sub(camera.eye(), origin)) * Math.tan(camera.fov / 2) * 0.3
	const handlesFor = (origin: Vec, size: number, tool: Tool): Handle[] =>
		([0, 1, 2] as const).map((axis) => {
			if (tool !== 'rotate') return { axis, points: [origin, v3.add(origin, v3.scale(AXES[axis]!, size))] }
			const u1: Vec = axis === 0 ? [0, 1, 0] : axis === 1 ? [0, 0, 1] : [1, 0, 0]
			const v1: Vec = axis === 0 ? [0, 0, 1] : axis === 1 ? [1, 0, 0] : [0, 1, 0]
			return { axis, points: Array.from({ length: RING + 1 }, (_, index): Vec => v3.add(origin, v3.add(v3.scale(u1, Math.cos((index / RING) * Math.PI * 2) * size * 0.9), v3.scale(v1, Math.sin((index / RING) * Math.PI * 2) * size * 0.9)))) }
		})

	const rayAt = (clientX: number, clientY: number): { readonly origin: Vec; readonly direction: Vec } => {
		const rect = canvas.getBoundingClientRect()
		return camera.ray(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2, rect.width / rect.height)
	}
	const handleAt = (clientX: number, clientY: number): Handle | undefined => {
		const selected = primary()
		if (selected === undefined) return undefined
		const rect = canvas.getBoundingClientRect()
		const px = clientX - rect.left
		const py = clientY - rect.top
		let best: Handle | undefined
		let bestDistance = HIT_PIXELS
		for (const handle of handlesFor(selected.position, gizmoSize(selected.position), activeTool())) {
			for (let index = 0; index + 1 < handle.points.length; index++) {
				const a = project(viewProj, handle.points[index]!, rect.width, rect.height)
				const b = project(viewProj, handle.points[index + 1]!, rect.width, rect.height)
				if (a === undefined || b === undefined) continue
				const abx = b.x - a.x
				const aby = b.y - a.y
				const lengthSquared = abx * abx + aby * aby
				const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * abx + (py - a.y) * aby) / lengthSquared))
				const distance = Math.hypot(px - (a.x + abx * t), py - (a.y + aby * t))
				if (distance < bestDistance) {
					bestDistance = distance
					best = handle
				}
			}
		}
		return best
	}

	const render = (): void => {
		collect()
		gl.viewport(0, 0, canvas.width, canvas.height)
		gl.clearColor(0.06, 0.07, 0.08, 1)
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
		gl.enable(gl.DEPTH_TEST)
		gl.depthFunc(gl.LEQUAL)
		gl.enable(gl.BLEND)
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
		gl.useProgram(program)
		viewProj = arrayBuffer(multiply(camera.projection(canvas.width / Math.max(1, canvas.height)), camera.view()))
		gl.uniformMatrix4fv(u.viewProj, false, viewProj)
		gl.uniform1i(u.tex, 0)
		gl.uniform4fv(u.lightA, lightA)
		gl.uniform4fv(u.lightB, lightB)
		const identity = scaleMatrix(1, 1, 1)
		if (options.isGridVisible()) {
			draw(geo.gridMinor, gl.LINES, identity, [1, 1, 1, 0.06], 0)
			draw(geo.gridMajor, gl.LINES, identity, [1, 1, 1, 0.14], 0)
		}
		draw(geo.axisX, gl.LINES, identity, [...AXIS_COLORS[0]!, 0.9], 0)
		draw(geo.axisY, gl.LINES, identity, [...AXIS_COLORS[1]!, 0.9], 0)
		draw(geo.axisZ, gl.LINES, identity, [...AXIS_COLORS[2]!, 0.9], 0)
		const unit = camera.distance * 0.0032
		for (const item of items) {
			if (item.kind === 'mesh' || item.kind === 'shape') {
				const geometry = item.kind === 'shape' ? geo.box : item.shape === 'sphere' ? geo.sphere : item.shape === 'cylinder' ? geo.cylinder : item.shape === 'plane' ? geo.plane : geo.box
				draw(geometry, gl.TRIANGLES, item.model, [...item.color, 1], 1)
			}
		}
		for (const item of items) {
			const [px, py, pz] = item.position
			const column = (index: number): Vec => v3.normalize([item.world[index * 4]!, item.world[index * 4 + 1]!, item.world[index * 4 + 2]!])
			if (item.kind === 'sprite') {
				const texture = textureFor(item.sprite)
				if (texture === undefined) draw(geo.box, gl.TRIANGLES, item.model, [0.6, 0.6, 0.65, 1], 1)
				else draw(geo.quad, gl.TRIANGLES, item.model, [1, 1, 1, 1], 0, texture)
			} else if (item.kind === 'light') {
				draw(geo.sphere, gl.TRIANGLES, item.model, [1, 0.9, 0.4, 1], 0)
				bar([px, py, pz], v3.sub([px, py, pz], v3.scale(column(2), 140)), unit * 1.2, [1, 0.9, 0.4, 1])
			} else if (item.kind === 'camera') {
				const forward = v3.scale(column(2), -1)
				const depth = 120
				const half = Math.tan((item.fov * Math.PI) / 360) * depth
				const centre = v3.add(item.position, v3.scale(forward, depth))
				const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => v3.add(centre, v3.add(v3.scale(column(0), (sx as number) * half * (16 / 9)), v3.scale(column(1), (sy as number) * half))))
				corners.forEach((corner, index) => {
					bar(item.position, corner, unit, [0.8, 0.8, 0.85, 1])
					bar(corner, corners[(index + 1) % 4]!, unit, [0.8, 0.8, 0.85, 1])
				})
			} else if (item.kind === 'empty') {
				for (let axis = 0; axis < 3; axis++) bar(item.position, v3.add(item.position, v3.scale(column(axis), 24)), unit, [...AXIS_COLORS[axis]!, 1])
			}
		}
		for (const item of items) {
			if (!session.isSelected(item.entity)) continue
			for (let index = 0; index < EDGES.length; index += 2) bar(transformPoint(item.pickModel, CORNERS[EDGES[index]!]!), transformPoint(item.pickModel, CORNERS[EDGES[index + 1]!]!), unit * 1.1, [0.36, 0.62, 1, 1])
		}
		const selected = primary()
		if (selected !== undefined) {
			gl.disable(gl.DEPTH_TEST)
			const tool = activeTool()
			const size = gizmoSize(selected.position)
			for (const handle of handlesFor(selected.position, size, tool)) {
				const active = hover?.axis === handle.axis || (drag?.kind === 'gizmo' && drag.handle.axis === handle.axis)
				const color = [...(active ? HOT : AXIS_COLORS[handle.axis]!), 1]
				for (let index = 0; index + 1 < handle.points.length; index++) bar(handle.points[index]!, handle.points[index + 1]!, size * 0.022, color)
				if (tool !== 'rotate') {
					const end = handle.points[1]!
					const s = size * (tool === 'scale' ? 0.12 : 0.09)
					draw(geo.box, gl.TRIANGLES, new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, end[0], end[1], end[2], 1]), color, 0)
				}
			}
			gl.enable(gl.DEPTH_TEST)
		}
		snapButton.dataset['active'] = String(snap)
		label.textContent = `${activeTool()} · snap ${snap ? 'on' : 'off'} · ${items.length} node${items.length === 1 ? '' : 's'}`
	}

	const pickAt = (clientX: number, clientY: number, additive: boolean): void => {
		const ray = rayAt(clientX, clientY)
		let best: Item | undefined
		let bestDistance = Infinity
		for (const item of items) {
			if (item.pickInverse === undefined) continue
			const distance = rayBox(ray, item.pickInverse)
			if (distance !== undefined && distance < bestDistance) {
				bestDistance = distance
				best = item
			}
		}
		if (best !== undefined) session.select(best.entity, additive ? 'toggle' : 'replace')
		else if (!additive) session.select(undefined)
	}

	/** A world position as the entity's own, parent-relative position. */
	const toLocal = (entity: Entity, point: Vec): Vec => {
		const link = session.world.get(entity, Parent)
		const parent = link === undefined ? undefined : session.transforms.worldMatrix(link.parent)
		const inverse = parent === undefined ? undefined : invert(new Float32Array(Array.from(parent.elements)))
		return inverse === undefined ? point : transformPoint(inverse, point)
	}

	const startGizmo = (handle: Handle, event: PointerEvent): void => {
		const selected = primary()
		if (selected === undefined) return
		const tool = activeTool()
		const starts = new Map<Entity, { readonly position: Vec; readonly rotation: Quat; readonly scale: Vec }>()
		for (const entity of session.selected) {
			const item = items.find((candidate) => candidate.entity === entity)
			const t = session.getTransform(entity)
			if (item === undefined || t === undefined) continue
			starts.set(entity, { position: item.position, rotation: [t.qx, t.qy, t.qz, t.qw], scale: [t.sx, t.sy, t.sz] })
		}
		const axis = AXES[handle.axis]!
		drag = { kind: 'gizmo', tool, handle, origin: selected.position, s0: tool === 'rotate' ? 0 : closestParam(rayAt(event.clientX, event.clientY), selected.position, axis), startX: event.clientX, starts }
	}

	const dragGizmo = (current: Extract<Drag, { readonly kind: 'gizmo' }>, event: PointerEvent): void => {
		const index = current.handle.axis
		const axis = AXES[index]!
		const patches = new Map<Entity, Partial<TransformData>>()
		if (current.tool === 'rotate') {
			let angle = (event.clientX - current.startX) * 0.01
			if (snap) angle = Math.round(angle / SNAP_ANGLE) * SNAP_ANGLE
			const turn = quatAxisAngle(axis, angle)
			for (const [entity, start] of current.starts) {
				const q = quatMultiply(turn, start.rotation)
				patches.set(entity, { qx: q[0], qy: q[1], qz: q[2], qw: q[3] })
			}
		} else {
			const delta = closestParam(rayAt(event.clientX, event.clientY), current.origin, axis) - current.s0
			for (const [entity, start] of current.starts) {
				if (current.tool === 'move') {
					let along = delta
					if (snap) {
						const base = start.position[index]!
						along = Math.round((base + delta) / SNAP_MOVE) * SNAP_MOVE - base
					}
					const local = toLocal(entity, v3.add(start.position, v3.scale(axis, along)))
					patches.set(entity, { x: local[0], y: local[1], z: local[2] })
				} else {
					let factor = Math.max(0.05, 1 + delta / gizmoSize(current.origin))
					if (snap) factor = Math.max(0.1, Math.round(factor * 10) / 10)
					const next = start.scale[index]! * factor
					patches.set(entity, index === 0 ? { sx: next } : index === 1 ? { sy: next } : { sz: next })
				}
			}
		}
		session.setTransforms(patches)
	}

	const onDown = (event: PointerEvent): void => {
		canvas.focus()
		canvas.setPointerCapture(event.pointerId)
		event.preventDefault()
		if (event.button === 0 && !event.altKey) {
			const handle = handleAt(event.clientX, event.clientY)
			if (handle !== undefined) startGizmo(handle, event)
			else drag = { kind: 'select', startX: event.clientX, startY: event.clientY, moved: false }
		} else {
			drag = { kind: 'camera', mode: event.button === 1 || (event.button === 2 && event.shiftKey) ? 'pan' : 'orbit', x: event.clientX, y: event.clientY }
		}
		dirty = true
	}
	const onMove = (event: PointerEvent): void => {
		if (drag === undefined) {
			const next = handleAt(event.clientX, event.clientY)
			if (next?.axis !== hover?.axis) {
				hover = next
				canvas.style.cursor = next === undefined ? '' : 'pointer'
				dirty = true
			}
			return
		}
		if (drag.kind === 'camera') {
			const dx = event.clientX - drag.x
			const dy = event.clientY - drag.y
			drag.x = event.clientX
			drag.y = event.clientY
			if (drag.mode === 'orbit') camera.orbit(dx, dy)
			else camera.pan(dx, dy, canvas.clientHeight)
		} else if (drag.kind === 'select') {
			if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true
		} else dragGizmo(drag, event)
		dirty = true
	}
	const onUp = (event: PointerEvent): void => {
		if (drag?.kind === 'select' && !drag.moved) pickAt(event.clientX, event.clientY, event.shiftKey || event.ctrlKey || event.metaKey)
		drag = undefined
		if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
		dirty = true
	}
	const onWheel = (event: WheelEvent): void => {
		event.preventDefault()
		camera.zoom(event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY)
		dirty = true
	}
	const frameSelection = (): void => {
		const selected = primary()
		camera.target = selected === undefined ? [0, 100, 0] : [...selected.position]
		camera.distance = selected === undefined ? 900 : 450
	}
	const onKey = (event: KeyboardEvent): void => {
		if (event.ctrlKey || event.metaKey || event.altKey) return
		const key = event.key.toLowerCase()
		if (key === 'f') frameSelection()
		else if (key === 'y') snap = !snap
		else if (event.key === 'Home') {
			camera.preset('persp')
			camera.distance = 900
			camera.target = [0, 100, 0]
		} else return
		dirty = true
		event.preventDefault()
	}
	const onMenu = (event: Event): void => event.preventDefault()

	const panel = document.createElement('div')
	panel.className = 'vp3-bar'
	const button = (text: string, title: string, run: () => void): HTMLButtonElement => {
		const element = document.createElement('button')
		element.type = 'button'
		element.className = 'vp3-button'
		element.textContent = text
		element.title = title
		element.addEventListener('click', () => {
			run()
			dirty = true
			canvas.focus()
		})
		return element
	}
	const snapButton = button('Snap', 'Snap moves to 25 units, rotation to 15 degrees and scale to 0.1 (Y)', () => {
		snap = !snap
	})
	panel.append(
		button('Persp', 'Perspective view', () => camera.preset('persp')),
		button('Front', 'Front view', () => camera.preset('front')),
		button('Right', 'Right view', () => camera.preset('right')),
		button('Top', 'Top view', () => camera.preset('top')),
		button('Frame', 'Look at the selection (F)', frameSelection),
		snapButton
	)
	const label = document.createElement('div')
	label.className = 'vp3-label'
	host.append(panel, label)

	canvas.addEventListener('pointerdown', onDown)
	canvas.addEventListener('pointermove', onMove)
	canvas.addEventListener('pointerup', onUp)
	canvas.addEventListener('wheel', onWheel, { passive: false })
	canvas.addEventListener('keydown', onKey)
	canvas.addEventListener('contextmenu', onMenu)

	const resize = (): void => {
		const ratio = devicePixelRatio || 1
		canvas.width = Math.max(1, Math.round(host.clientWidth * ratio))
		canvas.height = Math.max(1, Math.round(host.clientHeight * ratio))
		dirty = true
	}
	const observer = new ResizeObserver(resize)
	observer.observe(host)
	resize()
	const subscription = session.changed.subscribe(() => {
		dirty = true
	})
	const loop = (): void => {
		if (stopped) return
		const grid = options.isGridVisible()
		const tool = options.getTool()
		if (grid !== lastGrid || tool !== lastTool) {
			lastGrid = grid
			lastTool = tool
			dirty = true
		}
		if (dirty) {
			dirty = false
			render()
		}
		frameId = requestAnimationFrame(loop)
	}
	frameId = requestAnimationFrame(loop)
	options.onStatus('3D view · W move · E rotate · R scale · right-drag orbit · middle-drag pan · wheel zoom · F frame · Y snap')

	return () => {
		stopped = true
		cancelAnimationFrame(frameId)
		observer.disconnect()
		subscription.dispose()
		canvas.removeEventListener('pointerdown', onDown)
		canvas.removeEventListener('pointermove', onMove)
		canvas.removeEventListener('pointerup', onUp)
		canvas.removeEventListener('wheel', onWheel)
		canvas.removeEventListener('keydown', onKey)
		canvas.removeEventListener('contextmenu', onMenu)
		panel.remove()
		label.remove()
		gl.getExtension('WEBGL_lose_context')?.loseContext()
		canvas.remove()
	}
}
