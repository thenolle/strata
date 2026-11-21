import { StrataError, err, ok, type Result } from '@strata/core'
import { parseWhen, type ContextKeys, type WhenNode } from './context.ts'

export type Platform = 'mac' | 'other'

/**
 * The parts of a keyboard event the service needs, so it can be driven by tests as easily as by the browser.
 */
export interface KeyInput {
	readonly key: string
	readonly ctrlKey: boolean
	readonly shiftKey: boolean
	readonly altKey: boolean
	readonly metaKey: boolean
}

export interface Keystroke {
	readonly key: string
	readonly ctrl: boolean
	readonly shift: boolean
	readonly alt: boolean
	readonly meta: boolean
}

export interface Keybinding {
	/**
	 * One keystroke such as "ctrl+shift+p", or a chord of several separated by spaces such as "ctrl+k ctrl+c".
	 * "mod" means Cmd on macOS and Ctrl elsewhere. Write shifted symbols as the character produced.
	 */
	readonly keys: string
	readonly command: string
	readonly args?: unknown
	readonly when?: string
}

export type KeyOutcome =
	| { readonly kind: 'none' }
	| { readonly kind: 'pending'; readonly label: string }
	| { readonly kind: 'command'; readonly command: string; readonly args?: unknown }

interface CompiledBinding {
	readonly chord: readonly Keystroke[]
	readonly command: string
	readonly args: unknown
	readonly hasArgs: boolean
	readonly when: WhenNode | undefined
}

export interface KeybindingOptions {
	readonly platform?: Platform
	readonly chordTimeoutMs?: number
	readonly now?: () => number
}

const NONE: KeyOutcome = { kind: 'none' }
const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'altgraph', 'os', 'dead'])
const KEY_ALIASES: Readonly<Record<string, string>> = {
	esc: 'escape',
	del: 'delete',
	return: 'enter',
	ins: 'insert',
	pgup: 'pageup',
	pgdn: 'pagedown',
	up: 'arrowup',
	down: 'arrowdown',
	left: 'arrowleft',
	right: 'arrowright',
	spacebar: 'space',
	plus: '+',
	minus: '-',
	equal: '=',
	comma: ',',
	period: '.',
	slash: '/',
	backslash: '\\'
}
const KEY_LABELS: Readonly<Record<string, string>> = {
	arrowup: 'Up',
	arrowdown: 'Down',
	arrowleft: 'Left',
	arrowright: 'Right',
	escape: 'Esc',
	space: 'Space',
	delete: 'Del',
	pageup: 'PgUp',
	pagedown: 'PgDn'
}

export function detectPlatform(): Platform {
	return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? 'mac' : 'other'
}

function modifierOf(name: string, platform: Platform): 'ctrl' | 'shift' | 'alt' | 'meta' | undefined {
	switch (name) {
		case 'ctrl':
		case 'control': return 'ctrl'
		case 'shift': return 'shift'
		case 'alt':
		case 'option': return 'alt'
		case 'meta':
		case 'cmd':
		case 'command':
		case 'win':
		case 'super': return 'meta'
		case 'mod': return platform === 'mac' ? 'meta' : 'ctrl'
		default: return undefined
	}
}

function parseKeystroke(step: string, platform: Platform): Keystroke {
	const text = step.toLowerCase()
	const parts = text.endsWith('+') ? [...text.slice(0, -1).split('+').filter((part) => part !== ''), '+'] : text.split('+')
	const last = parts.pop()
	if (last === undefined || last === '') throw new SyntaxError(`Missing key in "${step}"`)
	const stroke = { ctrl: false, shift: false, alt: false, meta: false }
	for (const part of parts) {
		const modifier = modifierOf(part, platform)
		if (modifier === undefined) throw new SyntaxError(`Unknown modifier "${part}" in "${step}"`)
		stroke[modifier] = true
	}
	const key = KEY_ALIASES[last] ?? last
	if (MODIFIER_KEYS.has(key) || modifierOf(key, platform) !== undefined) throw new SyntaxError(`"${step}" needs a non-modifier key`)
	return { key, ...stroke }
}

export function parseChord(keys: string, platform: Platform = detectPlatform()): Result<readonly Keystroke[]> {
	try {
		const steps = keys.trim().split(/\s+/).filter((step) => step !== '')
		if (steps.length === 0 || steps.length > 3) throw new SyntaxError('A binding has one to three keystrokes')
		return ok(steps.map((step) => parseKeystroke(step, platform)))
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error)
		return err(new StrataError('invalid-format', `Invalid keybinding "${keys}": ${message}`, { cause: error }))
	}
}

export function strokeFromInput(input: KeyInput): Keystroke | undefined {
	const key = input.key === ' ' ? 'space' : input.key.toLowerCase()
	if (MODIFIER_KEYS.has(key)) return undefined
	return { key, ctrl: input.ctrlKey, shift: input.shiftKey, alt: input.altKey, meta: input.metaKey }
}

function strokesEqual(a: Keystroke | undefined, b: Keystroke | undefined): boolean {
	return a !== undefined && b !== undefined && a.key === b.key && a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.meta === b.meta
}

export function formatKeystroke(stroke: Keystroke, platform: Platform): string {
	const label = KEY_LABELS[stroke.key] ?? (stroke.key.length === 1 ? stroke.key.toUpperCase() : stroke.key.charAt(0).toUpperCase() + stroke.key.slice(1))
	if (platform === 'mac') return `${stroke.ctrl ? '⌃' : ''}${stroke.alt ? '⌥' : ''}${stroke.shift ? '⇧' : ''}${stroke.meta ? '⌘' : ''}${label}`
	return [stroke.ctrl ? 'Ctrl' : '', stroke.shift ? 'Shift' : '', stroke.alt ? 'Alt' : '', stroke.meta ? 'Meta' : '', label].filter((part) => part !== '').join('+')
}

/**
 * Resolves key presses to commands. Rules defined later take precedence, a rule's `when` must hold,
 * and multi-keystroke chords wait for their next key for a short time.
 */
export class KeybindingService {
	readonly #contexts: ContextKeys
	readonly #platform: Platform
	readonly #timeout: number
	readonly #now: () => number
	readonly #bindings: CompiledBinding[] = []
	#pending: readonly Keystroke[] = []
	#pendingAt = 0

	constructor(contexts: ContextKeys, options: KeybindingOptions = {}) {
		this.#contexts = contexts
		this.#platform = options.platform ?? detectPlatform()
		this.#timeout = options.chordTimeoutMs ?? 1500
		this.#now = options.now ?? Date.now
	}

	add(binding: Keybinding): Result<void> {
		const chord = parseChord(binding.keys, this.#platform)
		if (!chord.ok) return chord
		let when: WhenNode | undefined
		if (binding.when !== undefined) {
			const parsed = parseWhen(binding.when)
			if (!parsed.ok) return parsed
			when = parsed.value
		}
		this.#bindings.push({ chord: chord.value, command: binding.command, args: binding.args, hasArgs: 'args' in binding, when })
		return ok(undefined)
	}

	addAll(bindings: readonly Keybinding[]): Result<void> {
		for (const binding of bindings) {
			const added = this.add(binding)
			if (!added.ok) return added
		}
		return ok(undefined)
	}

	/**
	 * The shortcut text for a command, taken from its most recently added binding.
	 */
	labelFor(command: string): string | undefined {
		for (let index = this.#bindings.length - 1; index >= 0; index--) {
			const binding = this.#bindings[index]
			if (binding?.command === command) return binding.chord.map((stroke) => formatKeystroke(stroke, this.#platform)).join(' ')
		}
		return undefined
	}

	handle(input: KeyInput): KeyOutcome {
		const stroke = strokeFromInput(input)
		if (stroke === undefined) return NONE
		const now = this.#now()
		if (this.#pending.length > 0 && now - this.#pendingAt > this.#timeout) this.#pending = []
		let sequence = [...this.#pending, stroke]
		let outcome = this.#resolve(sequence)
		if (outcome.kind === 'none' && this.#pending.length > 0) {
			sequence = [stroke]
			outcome = this.#resolve(sequence)
		}
		this.#pending = outcome.kind === 'pending' ? sequence : []
		this.#pendingAt = now
		return outcome
	}

	#resolve(sequence: readonly Keystroke[]): KeyOutcome {
		let pending = false
		for (let index = this.#bindings.length - 1; index >= 0; index--) {
			const binding = this.#bindings[index]
			if (binding === undefined || binding.chord.length < sequence.length) continue
			if (!sequence.every((stroke, position) => strokesEqual(stroke, binding.chord[position]))) continue
			if (binding.when !== undefined && !this.#contexts.evaluate(binding.when)) continue
			if (binding.chord.length === sequence.length) return binding.hasArgs ? { kind: 'command', command: binding.command, args: binding.args } : { kind: 'command', command: binding.command }
			pending = true
		}
		return pending ? { kind: 'pending', label: `${sequence.map((stroke) => formatKeystroke(stroke, this.#platform)).join(' ')} …` } : NONE
	}
}
