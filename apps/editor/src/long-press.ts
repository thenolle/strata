/**
 * Calls back when a touch is held in place, which is how touch screens open context menus. Returns a function that detaches it.
 */
export function attachLongPress(
	root: HTMLElement,
	callback: (target: EventTarget | null, x: number, y: number) => void,
	delayMs = 500,
	tolerance = 8
): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined
	let startX = 0
	let startY = 0
	const cancel = (): void => {
		clearTimeout(timer)
		timer = undefined
	}
	const onDown = (event: PointerEvent): void => {
		if (event.pointerType !== 'touch') return
		cancel()
		startX = event.clientX
		startY = event.clientY
		const target = event.target
		timer = setTimeout(() => {
			timer = undefined
			callback(target, startX, startY)
		}, delayMs)
	}
	const onMove = (event: PointerEvent): void => {
		if (timer !== undefined && Math.hypot(event.clientX - startX, event.clientY - startY) > tolerance) cancel()
	}
	root.addEventListener('pointerdown', onDown)
	root.addEventListener('pointermove', onMove)
	root.addEventListener('pointerup', cancel)
	root.addEventListener('pointercancel', cancel)
	return () => {
		cancel()
		root.removeEventListener('pointerdown', onDown)
		root.removeEventListener('pointermove', onMove)
		root.removeEventListener('pointerup', cancel)
		root.removeEventListener('pointercancel', cancel)
	}
}
