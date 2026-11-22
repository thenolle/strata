import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LspClient, type RawDiagnostic } from './lsp.ts'
import { MAX_SCRIPT_BYTES } from './scripts.ts'

const NAME = /^[A-Za-z0-9_-]{1,64}$/

export interface CompletionOut {
	readonly label: string
	readonly kind: number
	readonly detail: string
	readonly insert: string
	readonly from: number | undefined
	readonly sort: string
}

export interface DiagnosticOut {
	readonly line: number
	readonly character: number
	readonly endLine: number
	readonly endCharacter: number
	readonly severity: number
	readonly message: string
}

interface Range {
	readonly start: { readonly line: number; readonly character: number }
	readonly end: { readonly line: number; readonly character: number }
}

function normalize(raw: unknown): CompletionOut[] {
	const item = raw as {
		readonly label?: unknown
		readonly kind?: unknown
		readonly detail?: unknown
		readonly sortText?: unknown
		readonly insertText?: unknown
		readonly textEdit?: { readonly newText?: unknown; readonly range?: Range; readonly replace?: Range }
	}
	if (typeof item.label !== 'string') return []
	const edit = item.textEdit
	const range = edit?.range ?? edit?.replace
	const text = typeof edit?.newText === 'string' ? edit.newText : typeof item.insertText === 'string' ? item.insertText : item.label
	return [
		{
			label: item.label,
			kind: typeof item.kind === 'number' ? item.kind : 0,
			detail: typeof item.detail === 'string' ? item.detail : '',
			insert: text.replace(/\$\{\d+:([^}]*)\}|\$\{\d+\}|\$\d+/g, '$1'),
			from: range !== undefined && range.start.line === range.end.line ? range.start.character : undefined,
			sort: typeof item.sortText === 'string' ? item.sortText : item.label
		}
	]
}

function hoverText(contents: unknown): string {
	if (typeof contents === 'string') return contents
	if (Array.isArray(contents)) return contents.map(hoverText).filter((part) => part !== '').join('\n\n')
	const value = contents as { readonly value?: unknown; readonly language?: unknown } | null
	if (value === null || typeof value !== 'object' || typeof value.value !== 'string') return ''
	return typeof value.language === 'string' ? `\`\`\`${value.language}\n${value.value}\n\`\`\`` : value.value
}

/**
 * The editor's language intelligence: one native TypeScript language server over a scratch project
 * that holds the script API and the scripts being edited.
 */
export class Ide {
	readonly #root: string
	readonly #directory: string
	readonly #versions = new Map<string, number>()
	#client: Promise<LspClient> | undefined
	#current: LspClient | undefined

	constructor(root: string) {
		this.#root = root
		this.#directory = join(root, '.cache/ide')
	}

	async sync(name: string, text: string): Promise<void> {
		const client = await this.#ensure()
		const file = `${name}.ts`
		const version = this.#versions.get(name)
		if (version === undefined) {
			await writeFile(join(this.#directory, file), text)
			this.#versions.set(name, 1)
			client.notify('textDocument/didOpen', { textDocument: { uri: this.#uri(file), languageId: 'typescript', version: 1, text } })
			return
		}
		this.#versions.set(name, version + 1)
		client.notify('textDocument/didChange', { textDocument: { uri: this.#uri(file), version: version + 1 }, contentChanges: [{ text }] })
	}

	async completion(name: string, line: number, character: number): Promise<CompletionOut[]> {
		const client = await this.#ensure()
		if (!this.#versions.has(name)) return []
		const result = await client.request('textDocument/completion', { textDocument: { uri: this.#uri(`${name}.ts`) }, position: { line, character }, context: { triggerKind: 1 } })
		const list = Array.isArray(result) ? result : ((result as { readonly items?: unknown[] } | null)?.items ?? [])
		return list.slice(0, 300).flatMap(normalize)
	}

	async hover(name: string, line: number, character: number): Promise<string> {
		const client = await this.#ensure()
		if (!this.#versions.has(name)) return ''
		const result = await client.request('textDocument/hover', { textDocument: { uri: this.#uri(`${name}.ts`) }, position: { line, character } })
		return hoverText((result as { readonly contents?: unknown } | null)?.contents)
	}

	async diagnostics(name: string): Promise<DiagnosticOut[]> {
		const client = this.#current
		if (client === undefined || !this.#versions.has(name)) return []
		let raw: readonly RawDiagnostic[] | undefined
		try {
			const result = await client.request('textDocument/diagnostic', { textDocument: { uri: this.#uri(`${name}.ts`) } })
			const items = (result as { readonly items?: readonly RawDiagnostic[] } | null)?.items
			if (items !== undefined) raw = items
		} catch {
			// The server only publishes diagnostics: use those.
		}
		raw ??= client.diagnostics.get(`${name}.ts`) ?? []
		return raw.map((item) => ({
			line: item.range.start.line,
			character: item.range.start.character,
			endLine: item.range.end.line,
			endCharacter: item.range.end.character,
			severity: item.severity ?? 1,
			message: item.message
		}))
	}

	async close(name: string): Promise<void> {
		if (!this.#versions.delete(name)) return
		const client = await this.#ensure()
		client.notify('textDocument/didClose', { textDocument: { uri: this.#uri(`${name}.ts`) } })
	}

	dispose(): void {
		this.#current?.dispose()
		this.#current = undefined
		this.#client = undefined
		this.#versions.clear()
	}

	/**
	 * Handles one request from the editor.
	 */
	async handle(action: string, body: unknown): Promise<Record<string, unknown>> {
		const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
		const name = input['name']
		if (typeof name !== 'string' || !NAME.test(name)) return { ok: false, error: 'Invalid document name' }
		const line = input['line']
		const character = input['character']
		const hasPosition = typeof line === 'number' && Number.isInteger(line) && line >= 0 && typeof character === 'number' && Number.isInteger(character) && character >= 0
		try {
			switch (action) {
				case 'sync': {
					const text = input['text']
					if (typeof text !== 'string' || text.length > MAX_SCRIPT_BYTES) return { ok: false, error: 'Invalid text' }
					await this.sync(name, text)
					return { ok: true }
				}
				case 'completion':
					return hasPosition ? { ok: true, items: await this.completion(name, line, character) } : { ok: false, error: 'Invalid position' }
				case 'hover':
					return hasPosition ? { ok: true, text: await this.hover(name, line, character) } : { ok: false, error: 'Invalid position' }
				case 'diagnostics':
					return { ok: true, diagnostics: await this.diagnostics(name) }
				case 'close':
					await this.close(name)
					return { ok: true }
				default:
					return { ok: false, error: 'Unknown action' }
			}
		} catch (error: unknown) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) }
		}
	}

	#uri(file: string): string {
		return pathToFileURL(join(this.#directory, file)).href
	}

	async #ensure(): Promise<LspClient> {
		if (this.#client !== undefined) {
			const existing = await this.#client
			if (existing.alive) return existing
			this.#client = undefined
			this.#versions.clear()
		}
		this.#client = this.#boot()
		return this.#client
	}

	async #boot(): Promise<LspClient> {
		await mkdir(this.#directory, { recursive: true })
		await copyFile(join(this.#root, 'packages/scripting/src/api.ts'), join(this.#directory, 'strata.ts'))
		await writeFile(
			join(this.#directory, 'tsconfig.json'),
			JSON.stringify({
				compilerOptions: { target: 'ES2022', module: 'esnext', moduleResolution: 'bundler', strict: true, noEmit: true, skipLibCheck: true, noUncheckedIndexedAccess: true, types: [], paths: { strata: ['./strata.ts'] } },
				include: ['*.ts']
			})
		)
		const client = LspClient.start(this.#root)
		await client.initialize(pathToFileURL(this.#directory).href)
		this.#current = client
		return client
	}
}
