import type { Entity, Guid } from '@strata/core'
import { OrbitCamera, modelMatrix, multiply, planeHit, pointInRect } from './camera3d.ts'
import type { ViewportOptions } from './viewport.ts'

const VERTEX = `#version 300 es
in vec3 p;
uniform mat4 mv;
uniform mat4 proj;
out vec2 uv;
out vec3 vp;
void main() {
	uv = p.xy + 0.5;
	vec4 viewPosition = mv * vec4(p, 1.0);
	vp = viewPosition.xyz;
	gl_Position = proj * viewPosition;
}`
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
in vec3 vp;
uniform vec4 color;
uniform sampler2D tex;
uniform bool useTex;
uniform float lit;
out vec4 outColor;
void main() {
	vec4 c = useTex ? texture(tex, vec2(uv.x, 1.0 - uv.y)) * color : color;
	if (c.a < 0.01) discard;
	if (lit > 0.5 && !useTex) {
		vec3 n = normalize(cross(dFdx(vp), dFdy(vp)));
		c.rgb *= 0.5 + 0.5 * abs(dot(n, normalize(vec3(0.3, 0.6, 0.7))));
	}
	outColor = c;
}`

const COLORS: readonly (readonly number[])[] = [[0.36, 0.62, 0.95], [0.45, 0.8, 0.55], [0.95, 0.62, 0.3], [0.8, 0.5, 0.9], [0.95, 0.45, 0.5], [0.4, 0.8, 0.85]]
const CORNERS: readonly (readonly number[])[] = [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]
const TRIANGLES = [4, 5, 6, 4, 6, 7, 1, 0, 3, 1, 3, 2, 5, 1, 2, 5, 2, 6, 0, 4, 7, 0, 7, 3, 7, 6, 2, 7, 2, 3, 0, 1, 5, 0, 5, 4]
const EDGES = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7]
const QUAD = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]
const BOX_DEPTH = 12
const LAYER = 0.5
const GRID = 1024
const CELL = 32

interface Geometry {
	readonly vao: WebGLVertexArrayObject
	readonly count: number
}

interface Item {
	readonly entity: Entity
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
	readonly rotation: number
}

function must<T>(value: T | null, what: string): T {
	if (value === null) throw new Error(`WebGL could not create ${what}`)
	return value
}

/**
 * A perspective view of the scene: orbit, pan and zoom around it, and click to select.
 * Entities have no depth yet, so this shows the 2D scene standing in space.
 */
export function startViewport3D(options: ViewportOptions): () => void {
	const { host, session } = options
	const canvas = document.createElement('canvas')
	canvas.tabIndex = 0
	canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:none'
	host.prepend(canvas)
	const gl = canvas.getContext('webgl2', { antialias: true })
	if (gl === null) {
		options.onStatus('The 3D view needs WebGL 2, which this browser does not offer')
		return () => canvas.remove()
	}
	const camera = new OrbitCamera()
	const textures = new Map<string, WebGLTexture | null>()
	let items: readonly Item[] = []
	let view = camera.view()
	let dirty = true
	let stopped = false
	let lastGrid = options.isGridVisible()
	let frameId = 0
	let program: WebGLProgram
	let boxGeometry: Geometry
	let edgeGeometry: Geometry
	let quadGeometry: Geometry
	let gridGeometry: Geometry
	let axisGeometry: Geometry
	let uniforms: Record<'mv' | 'proj' | 'color' | 'tex' | 'useTex' | 'lit', WebGLUniformLocation | null>

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
		const location = gl.getAttribLocation(program, 'p')
		const make = (data: readonly number[]): Geometry => {
			const vao = must(gl.createVertexArray(), 'a vertex array')
			gl.bindVertexArray(vao)
			gl.bindBuffer(gl.ARRAY_BUFFER, must(gl.createBuffer(), 'a buffer'))
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW)
			gl.enableVertexAttribArray(location)
			gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0)
			gl.bindVertexArray(null)
			return { vao, count: data.length / 3 }
		}
		const through = (indices: readonly number[]): number[] => indices.flatMap((index) => [...(CORNERS[index] ?? [0, 0, 0])])
		boxGeometry = make(through(TRIANGLES))
		edgeGeometry = make(through(EDGES))
		quadGeometry = make(QUAD)
		const lines: number[] = []
		for (let step = -GRID; step <= GRID; step += CELL) lines.push(step, -GRID, 0, step, GRID, 0, -GRID, step, 0, GRID, step, 0)
		gridGeometry = make(lines)
		axisGeometry = make([0, 0, 0, 160, 0, 0, 0, 0, 0, 0, 160, 0, 0, 0, 0, 0, 0, 160])
		uniforms = { mv: gl.getUniformLocation(program, 'mv'), proj: gl.getUniformLocation(program, 'proj'), color: gl.getUniformLocation(program, 'color'), tex: gl.getUniformLocation(program, 'tex'), useTex: gl.getUniformLocation(program, 'useTex'), lit: gl.getUniformLocation(program, 'lit') }
	} catch (error: unknown) {
		options.onStatus(`The 3D view could not start: ${error instanceof Error ? error.message : String(error)}`)
		return () => canvas.remove()
	}

	const definitions = [...session.registry.definitions()]
	const collider = definitions.find((definition) => definition.name === 'collider')
	const extent = (entity: Entity): { readonly width: number; readonly height: number } => {
		const id = session.spriteOf(entity)
		const record = id === '' ? undefined : session.project.assets.get(id as Guid)
		if (record?.kind === 'image') return { width: record.image.width, height: record.image.height }
		if (collider !== undefined && session.world.has(entity, collider)) {
			if (session.componentValue(entity, collider, 'shape') === 'circle') {
				const diameter = Number(session.componentValue(entity, collider, 'radius') ?? 16) * 2
				return { width: diameter, height: diameter }
			}
			return { width: Number(session.componentValue(entity, collider, 'width') ?? 32), height: Number(session.componentValue(entity, collider, 'height') ?? 32) }
		}
		return { width: 32, height: 32 }
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
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
			textures.set(assetId, texture)
			dirty = true
		})().catch(() => undefined)
		return undefined
	}

	const draw = (geometry: Geometry, mode: number, model: Float32Array, color: readonly number[], texture: WebGLTexture | undefined, lit: number): void => {
		gl.uniformMatrix4fv(uniforms.mv, false, multiply(view, model))
		gl.uniform4f(uniforms.color, color[0] ?? 1, color[1] ?? 1, color[2] ?? 1, color[3] ?? 1)
		gl.uniform1i(uniforms.useTex, texture === undefined ? 0 : 1)
		gl.uniform1f(uniforms.lit, lit)
		if (texture !== undefined) gl.bindTexture(gl.TEXTURE_2D, texture)
		gl.bindVertexArray(geometry.vao)
		gl.drawArrays(mode, 0, geometry.count)
	}

	const render = (): void => {
		gl.viewport(0, 0, canvas.width, canvas.height)
		gl.clearColor(0.06, 0.07, 0.08, 1)
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
		gl.enable(gl.DEPTH_TEST)
		gl.depthFunc(gl.LEQUAL)
		gl.enable(gl.BLEND)
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
		gl.useProgram(program)
		view = camera.view()
		gl.uniformMatrix4fv(uniforms.proj, false, camera.projection(canvas.width / Math.max(1, canvas.height)))
		gl.uniform1i(uniforms.tex, 0)
		const identity = modelMatrix(0, 0, 0, 0, 1, 1, 1)
		if (options.isGridVisible()) draw(gridGeometry, gl.LINES, identity, [1, 1, 1, 0.07], undefined, 0)
		draw(axisGeometry, gl.LINES, identity, [0.9, 0.3, 0.3, 1], undefined, 0)
		const rows = session.rows()
		const next: Item[] = []
		const sprites: { item: Item; z: number; texture: WebGLTexture }[] = []
		rows.forEach((row, index) => {
			const transform = session.getTransform(row.entity)
			if (transform === undefined) return
			const { width, height } = extent(row.entity)
			const item: Item = { entity: row.entity, x: transform.x, y: transform.y, width: width * Math.abs(transform.sx), height: height * Math.abs(transform.sy), rotation: (session.rotationDegrees(row.entity) * Math.PI) / 180 }
			next.push(item)
			const z = index * LAYER
			const assetId = session.spriteOf(row.entity)
			const texture = assetId === '' ? undefined : textureFor(assetId)
			if (texture !== undefined) sprites.push({ item, z, texture })
			else draw(boxGeometry, gl.TRIANGLES, modelMatrix(item.x, item.y, z, item.rotation, item.width, item.height, BOX_DEPTH), [...(COLORS[row.entity % COLORS.length] ?? [1, 1, 1]), 1], undefined, 1)
			if (session.isSelected(row.entity)) draw(edgeGeometry, gl.LINES, modelMatrix(item.x, item.y, z, item.rotation, item.width * 1.04, item.height * 1.04, BOX_DEPTH * 1.5), [0.36, 0.62, 1, 1], undefined, 0)
		})
		for (const sprite of sprites) draw(quadGeometry, gl.TRIANGLES, modelMatrix(sprite.item.x, sprite.item.y, sprite.z, sprite.item.rotation, sprite.item.width, sprite.item.height, 1), [1, 1, 1, 1], sprite.texture, 0)
		items = next
	}

	const pick = (clientX: number, clientY: number, additive: boolean): void => {
		const rect = canvas.getBoundingClientRect()
		const ray = camera.ray(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2, rect.width / rect.height)
		const hit = planeHit(ray)
		const found = hit === undefined ? undefined : [...items].reverse().find((item) => pointInRect(hit.x, hit.y, item.x, item.y, item.width, item.height, item.rotation))
		if (found !== undefined) session.select(found.entity, additive ? 'toggle' : undefined)
		else if (!additive) session.select(undefined)
	}

	let drag: { mode: 'select' | 'orbit' | 'pan'; x: number; y: number; startX: number; startY: number; moved: boolean } | undefined
	const onDown = (event: PointerEvent): void => {
		canvas.focus()
		canvas.setPointerCapture(event.pointerId)
		const mode = event.button === 1 || (event.button === 2 && event.shiftKey) ? 'pan' : event.button === 2 || (event.button === 0 && event.altKey) ? 'orbit' : 'select'
		drag = { mode, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false }
		event.preventDefault()
	}
	const onMove = (event: PointerEvent): void => {
		if (drag === undefined) return
		const dx = event.clientX - drag.x
		const dy = event.clientY - drag.y
		drag.x = event.clientX
		drag.y = event.clientY
		if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true
		if (drag.mode === 'orbit') camera.orbit(dx, dy)
		else if (drag.mode === 'pan') camera.pan(dx, dy, canvas.clientHeight)
		dirty = true
	}
	const onUp = (event: PointerEvent): void => {
		if (drag?.mode === 'select' && !drag.moved) pick(event.clientX, event.clientY, event.shiftKey || event.ctrlKey || event.metaKey)
		drag = undefined
		if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
	}
	const onWheel = (event: WheelEvent): void => {
		event.preventDefault()
		camera.zoom(event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY)
		dirty = true
	}
	const onKey = (event: KeyboardEvent): void => {
		if (event.ctrlKey || event.metaKey || event.altKey) return
		if (event.key === 'Home') camera.reset()
		else if (event.key.toLowerCase() === 'f') {
			const selected = items.find((item) => item.entity === session.selection)
			camera.target = selected === undefined ? [0, 0, 0] : [selected.x, selected.y, 0]
		} else return
		dirty = true
		event.preventDefault()
	}
	const onMenu = (event: Event): void => event.preventDefault()
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
	const frame = (): void => {
		if (stopped) return
		const grid = options.isGridVisible()
		if (grid !== lastGrid) {
			lastGrid = grid
			dirty = true
		}
		if (dirty) {
			dirty = false
			render()
		}
		frameId = requestAnimationFrame(frame)
	}
	frameId = requestAnimationFrame(frame)
	options.onStatus('3D view · right-drag orbit · middle-drag pan · wheel zoom · F focus · Home reset')

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
		gl.getExtension('WEBGL_lose_context')?.loseContext()
		canvas.remove()
	}
}
