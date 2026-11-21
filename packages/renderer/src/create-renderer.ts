import { Logger, StrataError, err, nullSink, ok, type Result } from '@strata/core'
import type { BackendKind, Renderer } from './renderer.ts'
import { WebGl2Renderer } from './webgl2-renderer.ts'
import { WebGpuRenderer } from './webgpu-renderer.ts'

const DEFAULT_ORDER: readonly BackendKind[] = ['webgpu', 'webgl2']

export interface RendererOptions {
	readonly backends?: readonly BackendKind[]
	readonly logger?: Logger
}

export interface BackendSupport {
	readonly secureContext: boolean
	readonly webgpu: boolean
	readonly webgl2: boolean
}

/**
 * Reports what the current page can attempt, probing WebGL2 on a throwaway canvas. It does not guarantee a backend will start.
 */
export function detectSupport(): BackendSupport {
	const probe = document.createElement('canvas').getContext('webgl2')
	probe?.getExtension('WEBGL_lose_context')?.loseContext()
	return { secureContext: window.isSecureContext, webgpu: 'gpu' in navigator, webgl2: probe !== null }
}

/**
 * Starts the first working backend in order of preference (WebGPU, then WebGL2 by default).
 */
export async function createRenderer(canvas: HTMLCanvasElement, options: RendererOptions = {}): Promise<Result<Renderer>> {
	const logger = options.logger ?? new Logger(nullSink, 'renderer')
	const order = options.backends ?? DEFAULT_ORDER
	const failures: string[] = []
	for (const backend of order) {
		try {
			return ok(backend === 'webgpu' ? await WebGpuRenderer.create(canvas, logger) : WebGl2Renderer.create(canvas, logger))
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error)
			failures.push(`${backend}: ${message}`)
			logger.warn('Graphics backend unavailable', { backend, message })
		}
	}
	return err(new StrataError('unsupported', failures.length === 0 ? 'No graphics backend was requested' : `No graphics backend could start (${failures.join('; ')})`))
}
