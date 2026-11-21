import { Emitter, StrataError, type Disposable, type Logger } from '@strata/core'
import type { SpriteBatch } from './sprite-batch.ts'

export type BackendKind = 'webgpu' | 'webgl2'
export type RendererStatus = 'ready' | 'recovering' | 'failed' | 'disposed'
export type TextureFilter = 'nearest' | 'linear'
export type Color = readonly [number, number, number, number]

/**
 * Tightly packed RGBA8 pixels with straight (non-premultiplied) alpha.
 */
export interface RawImage {
	readonly width: number
	readonly height: number
	readonly data: Uint8Array
}

/**
 * Pixel source for a texture. Create ImageBitmaps with `premultiplyAlpha: 'none'`.
 * The renderer keeps the source alive so textures can be rebuilt after a graphics loss.
 */
export type TextureSource = ImageBitmap | RawImage

export interface LossInfo {
	readonly message: string
}

export interface SpriteDraw {
	readonly texture: Texture
	readonly batch: SpriteBatch
}

export interface Frame {
	readonly clearColor: Color
	readonly viewProjection: Float32Array
	readonly draws: readonly SpriteDraw[]
}

export function isRawImage(source: TextureSource): source is RawImage {
	return 'data' in source
}

/**
 * Handle to a GPU texture owned by a renderer. Dispose it when no longer needed.
 */
export class Texture implements Disposable {
	readonly width: number
	readonly height: number
	readonly filter: TextureFilter
	readonly source: TextureSource
	#release: ((texture: Texture) => void) | undefined

	constructor(source: TextureSource, filter: TextureFilter, release: (texture: Texture) => void) {
		this.source = source
		this.width = source.width
		this.height = source.height
		this.filter = filter
		this.#release = release
	}

	get disposed(): boolean {
		return this.#release === undefined
	}

	dispose(): void {
		const release = this.#release
		if (release === undefined) return
		this.#release = undefined
		release(this)
	}
}

/**
 * Backend-independent renderer. Backends recover from device or context loss on their own,
 * announcing `lost` and then `restored`, or `failed` when recovery is impossible.
 */
export abstract class Renderer implements Disposable {
	abstract readonly backend: BackendKind
	readonly lost = new Emitter<LossInfo>()
	readonly restored = new Emitter<void>()
	readonly failed = new Emitter<StrataError>()
	protected readonly logger: Logger
	readonly #textures = new Set<Texture>()
	#status: RendererStatus = 'ready'

	protected constructor(logger: Logger) {
		this.logger = logger
	}

	get status(): RendererStatus {
		return this.#status
	}

	get textureCount(): number {
		return this.#textures.size
	}

	protected get liveTextures(): ReadonlySet<Texture> {
		return this.#textures
	}

	createTexture(source: TextureSource, filter: TextureFilter = 'nearest'): Texture {
		if (this.#status === 'disposed') throw new StrataError('disposed', 'Renderer has been disposed')
		const { width, height } = source
		if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new StrataError('invalid-argument', 'Texture size must be positive integers')
		if (isRawImage(source) && source.data.length !== width * height * 4) throw new StrataError('invalid-argument', 'Raw image data must hold width * height * 4 bytes')
		const texture = new Texture(source, filter, (released) => { if (this.#textures.delete(released)) this.destroyTexture(released) })
		this.#textures.add(texture)
		if (this.#status === 'ready') this.uploadTexture(texture)
		return texture
	}

	/**
	 * Draws one frame. Returns false when nothing was drawn, for example while recovering from a loss.
	 */
	abstract render(frame: Frame): boolean

	/**
	 * Forces a loss and recovery cycle, for testing recovery paths.
	 */
	abstract simulateLoss(): void

	dispose(): void {
		if (this.#status === 'disposed') return
		for (const texture of [...this.#textures]) texture.dispose()
		this.#status = 'disposed'
		this.releaseResources()
		this.lost.clear()
		this.restored.clear()
		this.failed.clear()
	}

	protected abstract uploadTexture(texture: Texture): void
	protected abstract destroyTexture(texture: Texture): void
	protected abstract releaseResources(): void

	protected setStatus(status: RendererStatus): void {
		if (this.#status !== 'disposed') this.#status = status
	}

	protected notify<T>(emitter: Emitter<T>, event: T): void {
		try { emitter.emit(event) } catch (error: unknown) { this.logger.error('Renderer listener failed', error) }
	}
}
