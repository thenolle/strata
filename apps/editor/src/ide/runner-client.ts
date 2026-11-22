export interface RunResult {
	readonly logs: readonly string[]
	readonly errors: readonly string[]
	readonly transform: { readonly x: number; readonly y: number }
	readonly steps: number
	readonly ms: number
}

export type RunOutcome = { readonly ok: true; readonly result: RunResult } | { readonly ok: false; readonly error: string }

const TIMEOUT_MS = 4000

let workerSource: Promise<string | undefined> | undefined

function loadWorker(): Promise<string | undefined> {
	workerSource ??= fetch('/assets/runner-worker.js')
		.then((response) => (response.ok ? response.text() : undefined))
		.catch(() => undefined)
	return workerSource
}

/**
 * Runs compiled script code for a number of steps in a sandboxed frame, inside a worker when the browser allows it.
 * The frame is removed when the run finishes or times out, which also stops an endless loop.
 */
export async function runCompiled(code: string, steps: number, held: readonly string[]): Promise<RunOutcome> {
	const worker = await loadWorker()
	return new Promise<RunOutcome>((resolve) => {
		const frame = document.createElement('iframe')
		frame.setAttribute('sandbox', 'allow-scripts')
		frame.title = 'Script runner'
		frame.hidden = true
		let done = false
		const finish = (outcome: RunOutcome): void => {
			if (done) return
			done = true
			clearTimeout(timer)
			removeEventListener('message', onMessage)
			frame.remove()
			resolve(outcome)
		}
		const timer = setTimeout(() => finish({ ok: false, error: `The script did not finish within ${TIMEOUT_MS / 1000} seconds. It may contain an endless loop.` }), TIMEOUT_MS)
		const onMessage = (event: MessageEvent): void => {
			if (event.source !== frame.contentWindow) return
			const data = event.data as { readonly type?: string; readonly result?: RunResult; readonly message?: string }
			if (data.type === 'ready') frame.contentWindow?.postMessage({ type: 'run', code, steps, held, ...(worker === undefined ? {} : { worker }) }, '*')
			else if (data.type === 'result' && data.result !== undefined) finish({ ok: true, result: data.result })
			else if (data.type === 'failure') finish({ ok: false, error: data.message ?? 'The script failed to load' })
		}
		addEventListener('message', onMessage)
		frame.src = '/play/runner.html'
		document.body.append(frame)
	})
}
