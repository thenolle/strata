import { runJob, type Job } from './run-job.ts'

interface RunMessage extends Job {
	readonly type: 'run'
	/** The worker's source text. The sandbox cannot fetch it, so the editor sends it. */
	readonly worker?: string
}

const post = (message: unknown): void => window.parent.postMessage(message, '*')

const fail = (error: unknown): void => post({ type: 'failure', message: error instanceof Error ? error.message : String(error) })

function inline(job: Job): void {
	void runJob(job).then((result) => post({ type: 'result', result }), fail)
}

function inWorker(message: RunMessage): void {
	if (message.worker === undefined || typeof Worker === 'undefined') return inline(message)
	let worker: Worker
	try {
		worker = new Worker(URL.createObjectURL(new Blob([message.worker], { type: 'text/javascript' })))
	} catch {
		return inline(message)
	}
	let answered = false
	worker.onmessage = (event: MessageEvent): void => {
		answered = true
		post(event.data)
	}
	worker.onerror = (): void => {
		if (answered) return
		answered = true
		worker.terminate()
		inline(message)
	}
	worker.postMessage({ code: message.code, steps: message.steps, held: message.held })
}

addEventListener('message', (event: MessageEvent<RunMessage>) => {
	if (event.source !== window.parent || typeof event.data !== 'object' || event.data === null || event.data.type !== 'run') return
	inWorker(event.data)
})
post({ type: 'ready' })
