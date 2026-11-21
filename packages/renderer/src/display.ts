/**
 * Resizes the canvas backing store to its displayed size times the pixel ratio. Returns true when the size changed.
 */
export function fitCanvasToDisplay(canvas: HTMLCanvasElement, pixelRatio: number = window.devicePixelRatio): boolean {
	const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio))
	const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio))
	if (canvas.width === width && canvas.height === height) return false
	canvas.width = width
	canvas.height = height
	return true
}
