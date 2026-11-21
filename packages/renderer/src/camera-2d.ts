import { StrataError } from '@strata/core'
import type { Vec2 } from '@strata/math'

/**
 * Orthographic camera with y pointing up. Zoom is pixels per world unit and the camera looks at (x, y).
 */
export class Camera2D {
	x = 0
	y = 0
	zoom = 1
	readonly viewProjection = new Float32Array(16)

	update(viewportWidth: number, viewportHeight: number): Float32Array {
		if (!(this.zoom > 0) || !(viewportWidth > 0) || !(viewportHeight > 0)) {
			throw new StrataError('invalid-argument', 'Camera zoom and viewport size must be positive')
		}
		const scaleX = (2 * this.zoom) / viewportWidth
		const scaleY = (2 * this.zoom) / viewportHeight
		const m = this.viewProjection
		m.fill(0)
		m[0] = scaleX
		m[5] = scaleY
		m[10] = 1
		m[12] = -this.x * scaleX
		m[13] = -this.y * scaleY
		m[15] = 1
		return m
	}

	screenToWorld(screenX: number, screenY: number, viewportWidth: number, viewportHeight: number, out: Vec2): Vec2 {
		return out.set(this.x + (screenX - viewportWidth / 2) / this.zoom, this.y - (screenY - viewportHeight / 2) / this.zoom)
	}
}
