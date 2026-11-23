import { startViewport, type ViewportOptions } from './viewport.ts'
import { startViewport3D } from './viewport3d.ts'

export type ViewMode = '2d' | '3d'
export type ViewportFactory = (options: ViewportOptions) => () => void

const KEY = 'strata.viewMode'

/**
 * Viewports by mode. The 3D viewport registers here when the 3D renderer exists, and the editor switches to it by itself.
 */
export const VIEWPORTS: Partial<Record<ViewMode, ViewportFactory>> = { '2d': startViewport, '3d': startViewport3D }

export function loadMode(): ViewMode {
	try {
		return localStorage.getItem(KEY) === '3d' ? '3d' : '2d'
	} catch {
		return '2d'
	}
}

export function saveMode(mode: ViewMode): void {
	try {
		localStorage.setItem(KEY, mode)
	} catch {
		// The preference is simply not remembered.
	}
}
