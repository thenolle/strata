const REQUEST_TIMEOUT_MS = 10_000

interface Pending {
	readonly resolve: (value: unknown) => void
	readonly reject: (error: Error) => void
	readonly timer: ReturnType<typeof setTimeout>
}

interface Sink {
	write(data: string | Uint8Array): unknown
	flush(): unknown
}

export interface RawDiagnostic {
	readonly range: { readonly start: { readonly line: number; readonly character: number }; readonly end: { readonly line: number; readonly character: number } }
	readonly severity?: number
	readonly message: string
}

function fileName(uri: string): string {
	return decodeURIComponent(uri).split('/').pop() ?? ''
}

/**
 * A minimal language server client over stdio: requests with replies, notifications, and the diagnostics the server publishes.
 */
export class LspClient {
	/** Latest diagnostics by file name. */
	readonly diagnostics = new Map<string, readonly RawDiagnostic[]>()
	readonly #sink: Sink
	readonly #stop: () => void
	readonly #pending = new Map<number, Pending>()
	#nextId = 1
	#buffer: Buffer = Buffer.alloc(0)
	#alive = true

	private constructor(sink: Sink, stop: () => void) {
		this.#sink = sink
		this.#stop = stop
	}

	get alive(): boolean {
		return this.#alive
	}

	/**
	 * Starts the project's native TypeScript language server.
	 */
	static start(root: string): LspClient {
		const child = Bun.spawn([process.execPath, 'run', 'tsc', '--lsp', '--stdio'], { cwd: root, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
		const client = new LspClient(child.stdin, () => child.kill())
		void client.#read(child.stdout)
		void child.exited.then(() => {
			client.#alive = false
			client.#failAll(new Error('The language server stopped'))
		})
		return client
	}

	async initialize(rootUri: string): Promise<void> {
		await this.request('initialize', {
			processId: null,
			rootUri,
			workspaceFolders: [{ uri: rootUri, name: 'scripts' }],
			capabilities: {
				textDocument: {
					completion: { completionItem: { snippetSupport: false, documentationFormat: ['markdown', 'plaintext'] } },
					hover: { contentFormat: ['markdown', 'plaintext'] },
					publishDiagnostics: {}
				},
				workspace: { configuration: false }
			}
		})
		this.notify('initialized', {})
	}

	request(method: string, params: unknown): Promise<unknown> {
		if (!this.#alive) return Promise.reject(new Error('The language server is not running'))
		const id = this.#nextId++
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id)
				reject(new Error(`The language server did not answer ${method}`))
			}, REQUEST_TIMEOUT_MS)
			this.#pending.set(id, { resolve, reject, timer })
			this.#send({ jsonrpc: '2.0', id, method, params })
		})
	}

	notify(method: string, params: unknown): void {
		if (this.#alive) this.#send({ jsonrpc: '2.0', method, params })
	}

	dispose(): void {
		this.#alive = false
		this.#stop()
		this.#failAll(new Error('The language server was stopped'))
	}

	#send(message: unknown): void {
		const body = new TextEncoder().encode(JSON.stringify(message))
		this.#sink.write(`Content-Length: ${body.length}\r\n\r\n`)
		this.#sink.write(body)
		this.#sink.flush()
	}

	#failAll(error: Error): void {
		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer)
			pending.reject(error)
		}
		this.#pending.clear()
	}

	async #read(stream: ReadableStream<Uint8Array>): Promise<void> {
		for await (const chunk of stream) {
			this.#buffer = Buffer.concat([this.#buffer, chunk])
			this.#drain()
		}
	}

	#drain(): void {
		for (;;) {
			const start = this.#buffer.indexOf('Content-Length:')
			if (start < 0) {
				if (this.#buffer.length > 1_000_000) this.#buffer = Buffer.alloc(0)
				return
			}
			if (start > 0) this.#buffer = this.#buffer.subarray(start)
			const headerEnd = this.#buffer.indexOf('\r\n\r\n')
			if (headerEnd < 0) return
			const match = /Content-Length:\s*(\d+)/i.exec(this.#buffer.subarray(0, headerEnd).toString('utf8'))
			const bodyStart = headerEnd + 4
			if (match === null) {
				this.#buffer = this.#buffer.subarray(bodyStart)
				continue
			}
			const length = Number(match[1])
			if (this.#buffer.length < bodyStart + length) return
			const body = this.#buffer.subarray(bodyStart, bodyStart + length).toString('utf8')
			this.#buffer = this.#buffer.subarray(bodyStart + length)
			try {
				this.#handle(JSON.parse(body) as Record<string, unknown>)
			} catch {
				// A malformed message is dropped.
			}
		}
	}

	#handle(message: Record<string, unknown>): void {
		const id = message['id']
		const method = message['method']
		if (typeof method === 'string') {
			if (id !== undefined) {
				this.#send({ jsonrpc: '2.0', id, result: null })
			} else if (method === 'textDocument/publishDiagnostics') {
				const params = message['params'] as { readonly uri?: unknown; readonly diagnostics?: readonly RawDiagnostic[] } | undefined
				if (typeof params?.uri === 'string') this.diagnostics.set(fileName(params.uri), params.diagnostics ?? [])
			}
			return
		}
		if (typeof id !== 'number') return
		const pending = this.#pending.get(id)
		if (pending === undefined) return
		this.#pending.delete(id)
		clearTimeout(pending.timer)
		const failure = message['error'] as { readonly message?: unknown } | undefined
		if (failure !== undefined) pending.reject(new Error(String(failure.message ?? 'Language server error')))
		else pending.resolve(message['result'])
	}
}
