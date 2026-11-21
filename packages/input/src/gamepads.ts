import { StrataError } from '@strata/core'
import { EdgeTracker } from './edge-tracker.ts'

const BUTTONS_PER_PAD = 64
const PRESS_THRESHOLD = 0.5

/**
 * Snapshot of one connected gamepad after deadzone processing. Indices follow the standard mapping when `mapping` is "standard".
 */
export interface GamepadState {
	readonly index: number
	readonly id: string
	readonly mapping: string
	readonly buttons: readonly number[]
	readonly axes: readonly number[]
}

/**
 * Polls connected gamepads once per frame. Sticks use a radial deadzone; other axes use a per-axis deadzone.
 */
export class GamepadTracker {
	readonly buttons = new EdgeTracker<number>()
	readonly #deadzone: number
	readonly #pads = new Map<number, GamepadState>()

	constructor(deadzone = 0.15) {
		if (!(deadzone >= 0 && deadzone < 1)) throw new StrataError('invalid-argument', 'Deadzone must be in [0, 1)')
		this.#deadzone = deadzone
	}

	get pads(): ReadonlyMap<number, GamepadState> {
		return this.#pads
	}

	poll(): void {
		this.#pads.clear()
		for (const pad of this.#snapshot()) {
			if (pad === null || !pad.connected) continue
			const values = pad.buttons.slice(0, BUTTONS_PER_PAD).map((button) => Math.max(button.value, button.pressed ? 1 : 0))
			this.#pads.set(pad.index, { index: pad.index, id: pad.id, mapping: pad.mapping, buttons: values, axes: this.#shape(pad.axes) })
			values.forEach((value, button) => {
				const key = pad.index * BUTTONS_PER_PAD + button
				if (value >= PRESS_THRESHOLD) this.buttons.press(key)
				else this.buttons.release(key)
			})
		}
		for (const key of [...this.buttons.down]) {
			if (!this.#pads.has(Math.floor(key / BUTTONS_PER_PAD))) this.buttons.release(key)
		}
	}

	commit(): void {
		this.buttons.commit()
	}

	buttonValue(button: number): number {
		let value = 0
		for (const pad of this.#pads.values()) value = Math.max(value, pad.buttons[button] ?? 0)
		return value
	}

	axisValue(axis: number, direction: 1 | -1): number {
		let value = 0
		for (const pad of this.#pads.values()) value = Math.max(value, direction * (pad.axes[axis] ?? 0))
		return value
	}

	wasButtonPressed(button: number): boolean {
		for (const pad of this.#pads.values()) {
			if (this.buttons.wasPressed(pad.index * BUTTONS_PER_PAD + button)) return true
		}
		return false
	}

	wasButtonReleased(button: number): boolean {
		for (const pad of this.#pads.values()) {
			if (this.buttons.wasReleased(pad.index * BUTTONS_PER_PAD + button)) return true
		}
		return false
	}

	findPressedButton(): number | undefined {
		for (const key of this.buttons.pressed) return key % BUTTONS_PER_PAD
		return undefined
	}

	findDeflectedAxis(threshold = 0.7): { readonly axis: number; readonly direction: 1 | -1 } | undefined {
		for (const pad of this.#pads.values()) {
			for (let axis = 0; axis < pad.axes.length; axis++) {
				const value = pad.axes[axis] ?? 0
				if (Math.abs(value) >= threshold) return { axis, direction: value > 0 ? 1 : -1 }
			}
		}
		return undefined
	}

	#snapshot(): readonly (Gamepad | null)[] {
		if (typeof navigator.getGamepads !== 'function') return []
		try {
			return navigator.getGamepads()
		} catch {
			return []
		}
	}

	#shape(axes: readonly number[]): number[] {
		const dz = this.#deadzone
		const shaped = axes.map((value) => (Number.isFinite(value) ? value : 0))
		for (let i = 0; i + 1 < shaped.length && i < 4; i += 2) {
			const x = shaped[i] ?? 0
			const y = shaped[i + 1] ?? 0
			const magnitude = Math.hypot(x, y)
			const scale = magnitude <= dz ? 0 : Math.min(1, (magnitude - dz) / (1 - dz)) / magnitude
			shaped[i] = x * scale
			shaped[i + 1] = y * scale
		}
		for (let i = 4; i < shaped.length; i++) {
			const value = shaped[i] ?? 0
			shaped[i] = Math.abs(value) <= dz ? 0 : (Math.sign(value) * (Math.abs(value) - dz)) / (1 - dz)
		}
		return shaped
	}
}
