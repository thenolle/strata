import { StrataError, type Disposable } from '@strata/core'
import type { Vec2 } from '@strata/math'
import type { ActionMap } from './action-map.ts'
import type { Binding } from './binding.ts'
import { EdgeTracker } from './edge-tracker.ts'
import { GamepadTracker } from './gamepads.ts'
import { PointerTracker, type PointerPhase } from './pointers.ts'

const PRESS_THRESHOLD = 0.5
const LINE_HEIGHT = 16

/**
 * State of one action for the current frame. `value` is the strongest binding in 0..1.
 */
export interface ActionState {
	readonly value: number
	readonly down: boolean
	readonly pressed: boolean
	readonly released: boolean
}

interface MutableActionState {
	value: number
	down: boolean
	pressed: boolean
	released: boolean
}

export interface InputOptions {
	/** Stop the browser acting on keys that are bound to actions, such as arrows scrolling. Default true. */
	readonly preventDefaultBoundKeys?: boolean
	/** Suppress the context menu on the canvas so right click can be bound. Default true. */
	readonly preventContextMenu?: boolean
	/** Consume the mouse wheel over the canvas instead of scrolling the page. Default true. */
	readonly captureWheel?: boolean
	/** Gamepad deadzone in [0, 1). Default 0.15. */
	readonly gamepadDeadzone?: number
}

function isEditable(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

/**
 * Collects keyboard, pointer, wheel and gamepad input and resolves it into named actions.
 * Call `update()` once at the start of every frame, then read actions.
 * The canvas gets `touch-action: none` while the manager is attached.
 */
export class InputManager implements Disposable {
	readonly keyboard = new EdgeTracker<string>()
	readonly pointers = new PointerTracker()
	readonly gamepads: GamepadTracker
	readonly #canvas: HTMLCanvasElement
	readonly #map: ActionMap
	readonly #options: Required<Omit<InputOptions, 'gamepadDeadzone'>>
	readonly #states = new Map<string, MutableActionState>()
	readonly #boundKeys = new Set<string>()
	readonly #previousTouchAction: string
	#syncedVersion = -1
	#wheel = 0
	#pendingWheel = 0
	#capture: ((binding: Binding | undefined) => void) | undefined
	#disposed = false

	readonly #onKeyDown = (event: KeyboardEvent): void => {
		if (isEditable(event.target)) return
		if (this.#capture !== undefined) {
			event.preventDefault()
			if (event.repeat) return
			this.#settle(event.code === 'Escape' ? undefined : { kind: 'key', code: event.code })
			return
		}
		this.keyboard.press(event.code)
		this.#sync()
		if (this.#options.preventDefaultBoundKeys && this.#boundKeys.has(event.code) && !event.ctrlKey && !event.metaKey && !event.altKey) {
			event.preventDefault()
		}
	}

	readonly #onKeyUp = (event: KeyboardEvent): void => {
		this.keyboard.release(event.code)
	}

	readonly #onPointer = (phase: PointerPhase) => (event: PointerEvent): void => {
		if (phase === 'down') {
			try {
				this.#canvas.setPointerCapture(event.pointerId)
			} catch {
				return
			}
		}
		this.pointers.handle(event, this.#canvas, phase)
	}

	readonly #onWheel = (event: WheelEvent): void => {
		const scale = event.deltaMode === 1 ? LINE_HEIGHT : event.deltaMode === 2 ? this.#canvas.clientHeight : 1
		this.#pendingWheel += event.deltaY * scale
		if (this.#options.captureWheel) event.preventDefault()
	}

	readonly #onContextMenu = (event: Event): void => {
		event.preventDefault()
	}

	readonly #onFocusLost = (): void => {
		this.keyboard.releaseAll()
		this.pointers.cancelAll()
	}

	readonly #onVisibility = (): void => {
		if (document.visibilityState === 'hidden') this.#onFocusLost()
	}

	readonly #pointerDown = this.#onPointer('down')
	readonly #pointerMove = this.#onPointer('move')
	readonly #pointerUp = this.#onPointer('up')
	readonly #pointerCancel = this.#onPointer('cancel')

	constructor(canvas: HTMLCanvasElement, map: ActionMap, options: InputOptions = {}) {
		this.#canvas = canvas
		this.#map = map
		this.gamepads = new GamepadTracker(options.gamepadDeadzone)
		this.#options = {
			preventDefaultBoundKeys: options.preventDefaultBoundKeys ?? true,
			preventContextMenu: options.preventContextMenu ?? true,
			captureWheel: options.captureWheel ?? true
		}
		this.#previousTouchAction = canvas.style.touchAction
		canvas.style.touchAction = 'none'
		addEventListener('keydown', this.#onKeyDown)
		addEventListener('keyup', this.#onKeyUp)
		addEventListener('blur', this.#onFocusLost)
		document.addEventListener('visibilitychange', this.#onVisibility)
		canvas.addEventListener('pointerdown', this.#pointerDown)
		canvas.addEventListener('pointermove', this.#pointerMove)
		canvas.addEventListener('pointerup', this.#pointerUp)
		canvas.addEventListener('pointercancel', this.#pointerCancel)
		canvas.addEventListener('wheel', this.#onWheel, { passive: false })
		if (this.#options.preventContextMenu) canvas.addEventListener('contextmenu', this.#onContextMenu)
	}

	/**
	 * Wheel movement since the previous update, in pixels. Positive scrolls down.
	 */
	get wheel(): number {
		return this.#wheel
	}

	/**
	 * Commits device state and resolves every action. Call once per frame before reading input.
	 */
	update(): void {
		this.#sync()
		this.keyboard.commit()
		this.pointers.commit()
		this.gamepads.poll()
		this.gamepads.commit()
		this.#wheel = this.#pendingWheel
		this.#pendingWheel = 0
		if (this.#capture !== undefined) this.#captureFromGamepad()
		for (const [name, state] of this.#states) {
			let value = 0
			let pressed = false
			let released = false
			for (const binding of this.#map.bindings(name)) {
				value = Math.max(value, this.#valueOf(binding))
				pressed ||= this.#pressedOf(binding)
				released ||= this.#releasedOf(binding)
			}
			const wasDown = state.down
			state.value = value
			state.down = value >= PRESS_THRESHOLD
			state.pressed = pressed || (state.down && !wasDown)
			state.released = released || (!state.down && wasDown)
		}
	}

	action(name: string): ActionState {
		this.#sync()
		const state = this.#states.get(name)
		if (state === undefined) throw new StrataError('invalid-argument', `Unknown action "${name}"`)
		return state
	}

	/**
	 * Combines two actions into a signed value: positive minus negative.
	 */
	axis(negative: string, positive: string): number {
		return this.action(positive).value - this.action(negative).value
	}

	/**
	 * Combines four actions into a vector with y up. Keyboard diagonals are normalized to length 1; analog input keeps its magnitude.
	 */
	vector(out: Vec2, left: string, right: string, down: string, up: string): Vec2 {
		out.set(this.axis(left, right), this.axis(down, up))
		const length = out.length()
		return length > 1 ? out.scale(1 / length) : out
	}

	/**
	 * Resolves with the next key or gamepad input, for rebinding screens. Escape or the abort signal cancels with undefined.
	 */
	captureBinding(signal?: AbortSignal): Promise<Binding | undefined> {
		this.#settle(undefined)
		return new Promise<Binding | undefined>((resolve) => {
			const onAbort = (): void => this.#settle(undefined)
			signal?.addEventListener('abort', onAbort, { once: true })
			this.#capture = (binding) => {
				signal?.removeEventListener('abort', onAbort)
				resolve(binding)
			}
			if (signal?.aborted === true) this.#settle(undefined)
		})
	}

	dispose(): void {
		if (this.#disposed) return
		this.#disposed = true
		this.#settle(undefined)
		removeEventListener('keydown', this.#onKeyDown)
		removeEventListener('keyup', this.#onKeyUp)
		removeEventListener('blur', this.#onFocusLost)
		document.removeEventListener('visibilitychange', this.#onVisibility)
		this.#canvas.removeEventListener('pointerdown', this.#pointerDown)
		this.#canvas.removeEventListener('pointermove', this.#pointerMove)
		this.#canvas.removeEventListener('pointerup', this.#pointerUp)
		this.#canvas.removeEventListener('pointercancel', this.#pointerCancel)
		this.#canvas.removeEventListener('wheel', this.#onWheel)
		this.#canvas.removeEventListener('contextmenu', this.#onContextMenu)
		this.#canvas.style.touchAction = this.#previousTouchAction
	}

	#sync(): void {
		if (this.#map.version === this.#syncedVersion) return
		const names = new Set(this.#map.actions())
		for (const name of names) {
			if (!this.#states.has(name)) this.#states.set(name, { value: 0, down: false, pressed: false, released: false })
		}
		for (const name of [...this.#states.keys()]) {
			if (!names.has(name)) this.#states.delete(name)
		}
		this.#boundKeys.clear()
		for (const name of names) {
			for (const binding of this.#map.bindings(name)) {
				if (binding.kind === 'key') this.#boundKeys.add(binding.code)
			}
		}
		this.#syncedVersion = this.#map.version
	}

	#valueOf(binding: Binding): number {
		switch (binding.kind) {
			case 'key': return this.keyboard.isDown(binding.code) ? 1 : 0
			case 'pointerButton': return this.pointers.buttons.isDown(binding.button) ? 1 : 0
			case 'gamepadButton': return this.gamepads.buttonValue(binding.button)
			case 'gamepadAxis': return this.gamepads.axisValue(binding.axis, binding.direction)
		}
	}

	#pressedOf(binding: Binding): boolean {
		switch (binding.kind) {
			case 'key': return this.keyboard.wasPressed(binding.code)
			case 'pointerButton': return this.pointers.buttons.wasPressed(binding.button)
			case 'gamepadButton': return this.gamepads.wasButtonPressed(binding.button)
			case 'gamepadAxis': return false
		}
	}

	#releasedOf(binding: Binding): boolean {
		switch (binding.kind) {
			case 'key': return this.keyboard.wasReleased(binding.code)
			case 'pointerButton': return this.pointers.buttons.wasReleased(binding.button)
			case 'gamepadButton': return this.gamepads.wasButtonReleased(binding.button)
			case 'gamepadAxis': return false
		}
	}

	#captureFromGamepad(): void {
		const button = this.gamepads.findPressedButton()
		if (button !== undefined) {
			this.#settle({ kind: 'gamepadButton', button })
			return
		}
		const axis = this.gamepads.findDeflectedAxis()
		if (axis !== undefined) this.#settle({ kind: 'gamepadAxis', axis: axis.axis, direction: axis.direction })
	}

	#settle(binding: Binding | undefined): void {
		const capture = this.#capture
		this.#capture = undefined
		capture?.(binding)
	}
}
