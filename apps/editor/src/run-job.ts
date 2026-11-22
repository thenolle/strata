import { simulateScript } from '@strata/scripting'

export interface Job {
	readonly code: string
	readonly steps: number
	readonly held: readonly string[]
}

export interface JobResult {
	readonly logs: readonly string[]
	readonly errors: readonly string[]
	readonly transform: { readonly x: number; readonly y: number }
	readonly steps: number
	readonly ms: number
}

/**
 * Loads a compiled script and simulates it. Console output and script logs share one ordered list.
 */
export async function runJob(job: Job): Promise<JobResult> {
	const lines: string[] = []
	const original = console.log
	console.log = (...values: unknown[]): void => {
		lines.push(values.map(String).join(' '))
	}
	try {
		const url = URL.createObjectURL(new Blob([job.code], { type: 'text/javascript' }))
		let loaded: { readonly default?: unknown }
		try {
			loaded = (await import(url)) as { readonly default?: unknown }
		} finally {
			URL.revokeObjectURL(url)
		}
		const started = performance.now()
		const result = simulateScript(loaded.default, { steps: job.steps, held: job.held, sink: lines })
		return { logs: lines, errors: result.errors, transform: result.transform, steps: result.steps, ms: performance.now() - started }
	} finally {
		console.log = original
	}
}
