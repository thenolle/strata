import { EdgeTracker } from './edge-tracker.ts'

export type PointerType = 'mouse' | 'touch' | 'pen'
export type PointerPhase = 'down' | 'move' | 'up' | 'cancel'

/**
 * A tracked pointer. Coordinates are canvas pixels with the origin at the top-left.
 */
export interface PointerState {
	readonly id: number
	readonly type: PointerType
	readonly x: number
	readonly y: number
}

interface MutablePointer {
	readonly id: number
	readonly type: PointerType
	x: number
	y: number
}

const BUTTON_MASKS = [1, 4, 2, 8, 16]

function toType(value: string): PointerType {
	return value === 'touch' || value === 'pen' ? value : 'mouse'
}

/**
 * Unifies mouse, touch and pen. A button counts as held while at least one pointer holds it,
 * so a second finger lifting does not release the first.
 */
export class PointerTracker {
	readonly buttons = new EdgeTracker<number>()
	readonly #pointers = new Map<number, MutablePointer>()
	readonly #holders = new Map<number, Set<number>>()
	#primaryId = -1

	get pointers(): ReadonlyMap<number, PointerState> {
		return this.#pointers
	}

	get primary(): PointerState | undefined {
		return this.#pointers.get(this.#primaryId) ?? this.#pointers.values().next().value
	}

	handle(event: PointerEvent, canvas: HTMLCanvasElement, phase: PointerPhase): void {
		const pointer = this.#locate(event, canvas)
		switch (phase) {
			case 'down':
				this.#hold(pointer.id, event.button)
				break
			case 'move':
				if (event.button >= 0) {
					const mask = BUTTON_MASKS[event.button] ?? 0
					if ((event.buttons & mask) !== 0) this.#hold(pointer.id, event.button)
					else this.#drop(pointer.id, event.button)
				}
				break
			case 'up':
				this.#drop(pointer.id, event.button)
				if (pointer.type !== 'mouse') this.#pointers.delete(pointer.id)
				break
			case 'cancel':
				this.#dropAll(pointer.id)
				if (pointer.type !== 'mouse') this.#pointers.delete(pointer.id)
				break
		}
	}

	cancelAll(): void {
		for (const id of [...this.#pointers.keys()]) this.#dropAll(id)
		for (const [id, pointer] of [...this.#pointers]) {
			if (pointer.type !== 'mouse') this.#pointers.delete(id)
		}
	}

	commit(): void {
		this.buttons.commit()
	}

	#locate(event: PointerEvent, canvas: HTMLCanvasElement): MutablePointer {
		let pointer = this.#pointers.get(event.pointerId)
		if (pointer === undefined) {
			pointer = { id: event.pointerId, type: toType(event.pointerType), x: 0, y: 0 }
			this.#pointers.set(pointer.id, pointer)
		}
		if (event.isPrimary) this.#primaryId = event.pointerId
		const rect = canvas.getBoundingClientRect()
		pointer.x = rect.width === 0 ? 0 : (event.clientX - rect.left) * (canvas.width / rect.width)
		pointer.y = rect.height === 0 ? 0 : (event.clientY - rect.top) * (canvas.height / rect.height)
		return pointer
	}

	#hold(pointerId: number, button: number): void {
		let holders = this.#holders.get(button)
		if (holders === undefined) {
			holders = new Set<number>()
			this.#holders.set(button, holders)
		}
		holders.add(pointerId)
		if (holders.size === 1) this.buttons.press(button)
	}

	#drop(pointerId: number, button: number): void {
		const holders = this.#holders.get(button)
		if (holders === undefined || !holders.delete(pointerId)) return
		if (holders.size === 0) this.buttons.release(button)
	}

	#dropAll(pointerId: number): void {
		for (const button of [...this.#holders.keys()]) this.#drop(pointerId, button)
	}
}
