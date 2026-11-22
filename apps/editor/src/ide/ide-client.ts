export interface Diagnostic {
	readonly line: number
	readonly character: number
	readonly endLine: number
	readonly endCharacter: number
	readonly severity: number
	readonly message: string
	readonly code?: string | number
}

export interface Completion {
	readonly label: string
	readonly kind: number
	readonly detail: string
	readonly insert: string
	readonly from: number | undefined
	readonly sort: string
	readonly raw?: unknown
	readonly snippet?: boolean
}

export interface HoverInfo {
	readonly text: string
	readonly range?: { readonly line: number; readonly character: number; readonly endLine: number; readonly endCharacter: number }
}

export interface TextEdit {
	readonly line: number
	readonly character: number
	readonly endLine: number
	readonly endCharacter: number
	readonly newText: string
}

export interface Signature {
	readonly label: string
	readonly documentation: string
	readonly parameters: readonly string[]
	readonly active: number
}

export interface Definition {
	readonly local?: { readonly line: number; readonly character: number }
	readonly external?: { readonly file: string; readonly text: string }
	readonly other?: { readonly path: string; readonly line: number; readonly character: number }
}

export interface Range {
	readonly line: number
	readonly character: number
	readonly endLine: number
	readonly endCharacter: number
}

export interface Place {
	readonly path: string
	readonly line: number
	readonly character: number
	readonly text: string
}

export interface DocSymbol {
	readonly name: string
	readonly kind: number
	readonly line: number
	readonly character: number
	readonly depth: number
}

export interface FileEdits {
	readonly path: string
	readonly edits: readonly TextEdit[]
}

export interface CodeAction {
	readonly title: string
	readonly edits: readonly TextEdit[]
	readonly others: readonly FileEdits[]
	readonly preferred: boolean
}

export interface Resolved {
	readonly detail: string
	readonly documentation: string
	readonly edits: readonly TextEdit[]
}

export interface RenameResult {
	readonly edits: readonly TextEdit[]
	readonly others: readonly FileEdits[]
}

export interface IdeClient {
	sync(name: string, text: string, path?: string): Promise<void>
	project(files: readonly { readonly path: string; readonly text: string }[]): Promise<void>
	completion(name: string, line: number, character: number): Promise<readonly Completion[]>
	hover(name: string, line: number, character: number): Promise<HoverInfo>
	diagnostics(name: string): Promise<readonly Diagnostic[]>
	close(name: string): Promise<void>
	definition(name: string, line: number, character: number): Promise<Definition | undefined>
	signature(name: string, line: number, character: number): Promise<Signature | undefined>
	format(name: string): Promise<readonly TextEdit[]>
	rename(name: string, line: number, character: number, newName: string): Promise<RenameResult>
	resolve(name: string, item: unknown): Promise<Resolved>
	references(name: string, line: number, character: number): Promise<readonly Place[]>
	symbols(name: string): Promise<readonly DocSymbol[]>
	highlights(name: string, line: number, character: number): Promise<readonly Range[]>
	actions(name: string, range: Range, diagnostics: readonly Diagnostic[]): Promise<readonly CodeAction[]>
}

async function call<T>(action: string, body: unknown): Promise<T> {
	const response = await fetch(`/api/ide/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
	const data = (await response.json()) as T & { readonly ok?: boolean; readonly error?: string }
	if (data.ok === false) throw new Error(data.error ?? 'The language server failed')
	return data
}

/**
 * Talks to the editor server's language server bridge.
 */
export const ideClient: IdeClient = {
	sync: async (name, text, path) => {
		await call('sync', { name, text, ...(path === undefined ? {} : { path }) })
	},
	project: async (files) => {
		await call('project', { files })
	},
	completion: async (name, line, character) => (await call<{ readonly items?: Completion[] }>('completion', { name, line, character })).items ?? [],
	hover: async (name, line, character) => {
		const data = await call<{ readonly text?: string; readonly range?: HoverInfo['range'] }>('hover', { name, line, character })
		return { text: data.text ?? '', ...(data.range === undefined ? {} : { range: data.range }) }
	},
	diagnostics: async (name) => (await call<{ readonly diagnostics?: Diagnostic[] }>('diagnostics', { name })).diagnostics ?? [],
	close: async (name) => {
		await call('close', { name })
	},
	definition: async (name, line, character) => (await call<{ readonly result?: Definition }>('definition', { name, line, character })).result,
	signature: async (name, line, character) => (await call<{ readonly result?: Signature }>('signature', { name, line, character })).result,
	format: async (name) => (await call<{ readonly edits?: TextEdit[] }>('format', { name })).edits ?? [],
	rename: async (name, line, character, newName) => {
		const data = await call<{ readonly edits?: TextEdit[]; readonly others?: FileEdits[] }>('rename', { name, line, character, newName })
		return { edits: data.edits ?? [], others: data.others ?? [] }
	},
	resolve: async (name, item) => {
		const data = await call<Partial<Resolved>>('resolve', { name, item })
		return { detail: data.detail ?? '', documentation: data.documentation ?? '', edits: data.edits ?? [] }
	},
	references: async (name, line, character) => (await call<{ readonly items?: Place[] }>('references', { name, line, character })).items ?? [],
	symbols: async (name) => (await call<{ readonly items?: DocSymbol[] }>('symbols', { name })).items ?? [],
	highlights: async (name, line, character) => (await call<{ readonly items?: Range[] }>('highlights', { name, line, character })).items ?? [],
	actions: async (name, range, diagnostics) => (await call<{ readonly items?: CodeAction[] }>('actions', { name, range, diagnostics })).items ?? [],
}
