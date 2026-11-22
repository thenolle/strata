import { runJob, type Job } from './run-job.ts'

interface WorkerScope {
	postMessage(message: unknown): void
	addEventListener(type: 'message', listener: (event: MessageEvent<Job>) => void): void
}

const scope = self as unknown as WorkerScope

// Defence in depth: the sandbox already has no network or storage, so remove the entry points as well.
for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker']) {
	try {
		delete (self as unknown as Record<string, unknown>)[key]
	} catch {
		// Not configurable here: the sandbox still blocks it.
	}
}

scope.addEventListener('message', (event) => {
	void runJob(event.data).then(
		(result) => scope.postMessage({ type: 'result', result }),
		(error: unknown) => scope.postMessage({ type: 'failure', message: error instanceof Error ? error.message : String(error) })
	)
})
