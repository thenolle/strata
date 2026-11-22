import { simulateScript } from '@strata/scripting'

interface RunMessage {
	readonly type: 'run'
	readonly code: string
	readonly steps: number
	readonly held: readonly string[]
}

function post(message: unknown): void {
	window.parent.postMessage(message, '*')
}

async function run(message: RunMessage): Promise<void> {
	const lines: string[] = []
	const original = console.log
	console.log = (...values: unknown[]): void => {
		lines.push(values.map(String).join(' '))
	}
	try {
		const loaded = (await import(URL.createObjectURL(new Blob([message.code], { type: 'text/javascript' })))) as { readonly default?: unknown }
		const started = performance.now()
		const result = simulateScript(loaded.default, { steps: message.steps, held: message.held, sink: lines })
		post({ type: 'result', result: { logs: lines, errors: result.errors, transform: result.transform, steps: result.steps, ms: performance.now() - started } })
	} finally {
		console.log = original
	}
}

addEventListener('message', (event: MessageEvent<RunMessage>) => {
	if (event.source !== window.parent || typeof event.data !== 'object' || event.data === null || event.data.type !== 'run') return
	void run(event.data).catch((error: unknown) => post({ type: 'failure', message: error instanceof Error ? error.message : String(error) }))
})
post({ type: 'ready' })
