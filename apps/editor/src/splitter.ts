export interface SplitterOptions {
	readonly axis: 'x' | 'y'
	/** 1 when dragging right or down makes the panel larger, -1 when it makes it smaller. */
	readonly direction: 1 | -1
	readonly min: number
	readonly max: () => number
	readonly value: () => number
	readonly apply: (value: number) => void
	readonly commit: () => void
	readonly reset: () => void
}

const STEP = 16

/**
 * Makes an element a draggable divider. Drag to resize, double click to reset, arrow keys to nudge.
 * Returns a function that detaches it.
 */
export function attachSplitter(handle: HTMLElement, options: SplitterOptions): () => void {
	let startPointer = 0
	let startValue = 0
	handle.tabIndex = 0
	handle.setAttribute('role', 'separator')
	handle.setAttribute('aria-orientation', options.axis === 'x' ? 'vertical' : 'horizontal')
	const clamp = (value: number): number => Math.round(Math.min(options.max(), Math.max(options.min, value)))
	const position = (event: PointerEvent): number => (options.axis === 'x' ? event.clientX : event.clientY)
	const onDown = (event: PointerEvent): void => {
		if (event.button !== 0) return
		handle.setPointerCapture(event.pointerId)
		startPointer = position(event)
		startValue = options.value()
		handle.dataset['dragging'] = 'true'
		event.preventDefault()
	}
	const onMove = (event: PointerEvent): void => {
		if (handle.dataset['dragging'] !== 'true') return
		options.apply(clamp(startValue + options.direction * (position(event) - startPointer)))
	}
	const onUp = (event: PointerEvent): void => {
		if (handle.dataset['dragging'] !== 'true') return
		delete handle.dataset['dragging']
		if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
		options.commit()
	}
	const onKey = (event: KeyboardEvent): void => {
		const forward = options.axis === 'x' ? 'ArrowRight' : 'ArrowDown'
		const backward = options.axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
		if (event.key !== forward && event.key !== backward) return
		event.preventDefault()
		options.apply(clamp(options.value() + options.direction * (event.key === forward ? STEP : -STEP)))
		options.commit()
	}
	const onDouble = (): void => options.reset()
	handle.addEventListener('pointerdown', onDown)
	handle.addEventListener('pointermove', onMove)
	handle.addEventListener('pointerup', onUp)
	handle.addEventListener('pointercancel', onUp)
	handle.addEventListener('keydown', onKey)
	handle.addEventListener('dblclick', onDouble)
	return () => {
		handle.removeEventListener('pointerdown', onDown)
		handle.removeEventListener('pointermove', onMove)
		handle.removeEventListener('pointerup', onUp)
		handle.removeEventListener('pointercancel', onUp)
		handle.removeEventListener('keydown', onKey)
		handle.removeEventListener('dblclick', onDouble)
	}
}
