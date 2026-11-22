export interface Diagnostic {
	readonly line: number
	readonly character: number
	readonly endLine: number
	readonly endCharacter: number
	readonly severity: number
	readonly message: string
}

export interface Completion {
	readonly label: string
	readonly kind: number
	readonly detail: string
	readonly insert: string
	readonly from: number | undefined
	readonly sort: string
}

export interface IdeClient {
	sync(name: string, text: string): Promise<void>
	completion(name: string, line: number, character: number): Promise<readonly Completion[]>
	hover(name: string, line: number, character: number): Promise<string>
	diagnostics(name: string): Promise<readonly Diagnostic[]>
	close(name: string): Promise<void>
}

async function call<T>(action: string, body: unknown): Promise<T> {
	const response = await fetch(`/api/ide/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
	return (await response.json()) as T
}

/**
 * Talks to the editor server's language server bridge.
 */
export const ideClient: IdeClient = {
	sync: async (name, text) => {
		await call('sync', { name, text })
	},
	completion: async (name, line, character) => (await call<{ readonly items?: Completion[] }>('completion', { name, line, character })).items ?? [],
	hover: async (name, line, character) => (await call<{ readonly text?: string }>('hover', { name, line, character })).text ?? '',
	diagnostics: async (name) => (await call<{ readonly diagnostics?: Diagnostic[] }>('diagnostics', { name })).diagnostics ?? [],
	close: async (name) => {
		await call('close', { name })
	}
}
