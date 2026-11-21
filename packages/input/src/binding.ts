/**
 * One physical input an action can listen to. Keys use KeyboardEvent.code, pointer buttons follow PointerEvent.button
 * (0 left, 1 middle, 2 right, 3 back, 4 forward), and gamepad indices follow the standard mapping.
 */
export type Binding =
	| { readonly kind: 'key'; readonly code: string }
	| { readonly kind: 'pointerButton'; readonly button: number }
	| { readonly kind: 'gamepadButton'; readonly button: number }
	| { readonly kind: 'gamepadAxis'; readonly axis: number; readonly direction: 1 | -1 }

const POINTER_NAMES = ['Left', 'Middle', 'Right', 'Back', 'Forward']

function isIndex(value: unknown, max: number): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max
}

export function isBinding(value: unknown): value is Binding {
	if (typeof value !== 'object' || value === null) return false
	const candidate = value as Record<string, unknown>
	switch (candidate['kind']) {
		case 'key': return typeof candidate['code'] === 'string' && candidate['code'].length > 0
		case 'pointerButton': return isIndex(candidate['button'], 4)
		case 'gamepadButton': return isIndex(candidate['button'], 63)
		case 'gamepadAxis': return isIndex(candidate['axis'], 15) && (candidate['direction'] === 1 || candidate['direction'] === -1)
		default: return false
	}
}

export function bindingsEqual(a: Binding, b: Binding): boolean {
	switch (a.kind) {
		case 'key': return b.kind === 'key' && a.code === b.code
		case 'pointerButton': return b.kind === 'pointerButton' && a.button === b.button
		case 'gamepadButton': return b.kind === 'gamepadButton' && a.button === b.button
		case 'gamepadAxis': return b.kind === 'gamepadAxis' && a.axis === b.axis && a.direction === b.direction
	}
}

/**
 * Short human-readable label for a binding, for settings screens and debug displays.
 */
export function describeBinding(binding: Binding): string {
	switch (binding.kind) {
		case 'key': return `Key ${binding.code.replace(/^(Key|Digit)/, '')}`
		case 'pointerButton': return `Mouse ${POINTER_NAMES[binding.button] ?? binding.button}`
		case 'gamepadButton': return `Pad button ${binding.button}`
		case 'gamepadAxis': return `Pad axis ${binding.axis}${binding.direction > 0 ? '+' : '-'}`
	}
}
