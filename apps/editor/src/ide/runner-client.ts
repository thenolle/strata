export interface RunResult {
	readonly logs: readonly string[]
	readonly errors: readonly string[]
	readonly transform: { readonly x: number; readonly y: number }
	readonly steps: number
	readonly ms: number
}

export type RunOutcome = { readonly ok: true; readonly result: RunResult } | { readonly ok: false; readonly error: string }

const TIMEOUT_MS = 4000

/**
 * Compiles a script and runs it for a number of steps in a sandboxed frame. The frame is removed when it finishes or times out.
 */
export async function runScript(source: string, steps: number, held: readonly string[]): Promise<RunOutcome> {
	const response = await fetch('/api/compile', { method: 'POST', body: source })
	const compiled = (await response.json()) as { readonly ok: true; readonly code: string } | { readonly ok: false; readonly error: string }
	if (!compiled.ok) return { ok: false, error: compiled.error }
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
			if (data.type === 'ready') frame.contentWindow?.postMessage({ type: 'run', code: compiled.code, steps, held }, '*')
			else if (data.type === 'result' && data.result !== undefined) finish({ ok: true, result: data.result })
			else if (data.type === 'failure') finish({ ok: false, error: data.message ?? 'The script failed to load' })
		}
		addEventListener('message', onMessage)
		frame.src = '/play/runner.html'
		document.body.append(frame)
	})
}
