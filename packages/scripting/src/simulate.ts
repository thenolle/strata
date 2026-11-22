import type { Entity } from '@strata/core'
import { ScriptHost } from './host.ts'

export interface SimulationOptions {
	readonly steps: number
	/** Keys held down for the whole run, such as "ArrowRight". */
	readonly held: readonly string[]
	readonly dt?: number
	readonly name?: string
	/** Where log lines go. Lets a caller interleave other output, such as console.log. */
	readonly sink?: string[]
}

export interface SimulationResult {
	readonly logs: readonly string[]
	readonly errors: readonly string[]
	readonly transform: { readonly x: number; readonly y: number }
	readonly steps: number
}

const MAX_LINES = 500

function show(value: unknown): string {
	if (typeof value === 'string') return value
	try {
		return JSON.stringify(value) ?? String(value)
	} catch {
		return String(value)
	}
}

/**
 * Runs a script's default export against one imaginary entity, with chosen keys held down, and reports what it did.
 */
export function simulateScript(exported: unknown, options: SimulationOptions): SimulationResult {
	const dt = options.dt ?? 1 / 60
	const held = new Set(options.held)
	const logs = options.sink ?? []
	const errors: string[] = []
	const transform = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, sx: 1, sy: 1, sz: 1 }
	const body = { kind: 'dynamic', vx: 0, vy: 0, mass: 1, restitution: 0, friction: 0.4, gravityScale: 1, grounded: 1 }
	const views: Readonly<Record<string, Record<string, number | string | boolean>>> = { transform, body }
	let step = 0
	const host = new ScriptHost({
		input: {
			isDown: (code) => held.has(code),
			wasPressed: (code) => held.has(code) && step === 0,
			axis: (negative, positive) => (held.has(positive) ? 1 : 0) - (held.has(negative) ? 1 : 0)
		},
		component: (_entity, name) => views[name],
		find: () => undefined,
		nameOf: () => options.name ?? 'Test',
		setPosition: (_entity, x, y) => {
			transform.x = x
			transform.y = y
		},
		log: (_entity, values) => {
			if (logs.length < MAX_LINES) logs.push(values.map(show).join(' '))
		},
		fail: (_entity, hook, error) => {
			if (errors.length < MAX_LINES) errors.push(`${hook}: ${error instanceof Error ? error.message : String(error)}`)
		}
	})
	if (host.attach(1 as Entity, exported)) {
		for (step = 0; step < options.steps; step++) host.update(dt)
	}
	host.dispose()
	return { logs, errors, transform: { x: transform.x, y: transform.y }, steps: options.steps }
}
