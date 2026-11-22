import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { LspClient, type RawDiagnostic } from './lsp.ts'
import { cleanScriptPath, MAX_SCRIPT_BYTES } from './scripts.ts'

const NAME = /^[A-Za-z0-9_-]{1,64}$/
const MAX_PROJECT_FILES = 200
const MAX_PROJECT_BYTES = 2 * 1024 * 1024

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

export interface TextEditOut {
	readonly line: number
	readonly character: number
	readonly endLine: number
	readonly endCharacter: number
	readonly newText: string
}

export interface SignatureOut {
	readonly label: string
	readonly documentation: string
	readonly parameters: readonly string[]
	readonly active: number
}

export interface DefinitionOut {
	readonly local?: { readonly line: number; readonly character: number }
	readonly external?: { readonly file: string; readonly text: string }
}

interface Position {
	readonly line: number
	readonly character: number
}

interface LspRange {
	readonly start: Position
	readonly end: Position
}

function uriFile(uri: string): string {
	return decodeURIComponent(uri).split('/').pop() ?? ''
}

function textOf(documentation: unknown): string {
	if (typeof documentation === 'string') return documentation
	const value = (documentation as { readonly value?: unknown } | null)?.value
	return typeof value === 'string' ? value : ''
}

function toEdits(list: unknown): TextEditOut[] {
	if (!Array.isArray(list)) return []
	return (list as { readonly range: LspRange; readonly newText: string }[]).map((edit) => ({
		line: edit.range.start.line,
		character: edit.range.start.character,
		endLine: edit.range.end.line,
		endCharacter: edit.range.end.character,
		newText: edit.newText
	}))
}

function normalize(raw: unknown): CompletionOut[] {
	const item = raw as {
		readonly label?: unknown
		readonly kind?: unknown
		readonly detail?: unknown
		readonly sortText?: unknown
		readonly insertText?: unknown
		readonly textEdit?: { readonly newText?: unknown; readonly range?: LspRange; readonly replace?: LspRange }
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
 * The editor's language intelligence: one native TypeScript language server over a scratch project.
 * The project's scripts are mirrored under their real paths, so imports between them resolve.
 */
export class Ide {
	readonly #root: string
	readonly #directory: string
	readonly #versions = new Map<string, number>()
	readonly #texts = new Map<string, string>()
	readonly #paths = new Map<string, string>()
	#client: Promise<LspClient> | undefined
	#current: LspClient | undefined

	constructor(root: string) {
		this.#root = root
		this.#directory = join(root, '.cache/ide')
	}

	/** The scratch-project file of an editor document: its real path when known. */
	#fileOf(name: string): string {
		return `project/${this.#paths.get(name) ?? `${name}.ts`}`
	}

	#relative(uri: string): string | undefined {
		try {
			const path = relative(this.#directory, fileURLToPath(uri)).replaceAll('\\', '/')
			return path.startsWith('..') ? undefined : path
		} catch {
			return undefined
		}
	}

	async #put(client: LspClient, file: string, text: string): Promise<void> {
		const version = this.#versions.get(file)
		if (version !== undefined && this.#texts.get(file) === text) return
		this.#texts.set(file, text)
		if (version === undefined) {
			const disk = join(this.#directory, file)
			await mkdir(dirname(disk), { recursive: true })
			await writeFile(disk, text)
			this.#versions.set(file, 1)
			client.notify('textDocument/didOpen', { textDocument: { uri: this.#uri(file), languageId: 'typescript', version: 1, text } })
			return
		}
		this.#versions.set(file, version + 1)
		client.notify('textDocument/didChange', { textDocument: { uri: this.#uri(file), version: version + 1 }, contentChanges: [{ text }] })
	}

	async sync(name: string, text: string, path?: string): Promise<void> {
		const client = await this.#ensure()
		if (path !== undefined) this.#paths.set(name, path)
		await this.#put(client, this.#fileOf(name), text)
	}

	/**
	 * Mirrors the project's scripts so imports between them resolve. Scripts open in the editor keep their live text.
	 */
	async syncProject(files: readonly { readonly path: string; readonly text: string }[]): Promise<void> {
		const client = await this.#ensure()
		const live = new Set([...this.#paths.keys()].map((name) => this.#fileOf(name)))
		const wanted = new Set<string>()
		for (const file of files) {
			const key = `project/${file.path}`
			wanted.add(key)
			if (!live.has(key)) await this.#put(client, key, file.text)
		}
		for (const key of [...this.#versions.keys()]) {
			if (wanted.has(key) || live.has(key)) continue
			this.#versions.delete(key)
			this.#texts.delete(key)
			client.notify('textDocument/didClose', { textDocument: { uri: this.#uri(key) } })
			await rm(join(this.#directory, key), { force: true })
		}
	}

	async completion(name: string, line: number, character: number): Promise<CompletionOut[]> {
		const client = await this.#ensure()
		const file = this.#fileOf(name)
		if (!this.#versions.has(file)) return []
		const result = await client.request('textDocument/completion', { textDocument: { uri: this.#uri(file) }, position: { line, character }, context: { triggerKind: 1 } })
		const list = Array.isArray(result) ? result : ((result as { readonly items?: unknown[] } | null)?.items ?? [])
		return list.slice(0, 300).flatMap(normalize)
	}

	async hover(name: string, line: number, character: number): Promise<{ readonly text: string; readonly range?: { readonly line: number; readonly character: number; readonly endLine: number; readonly endCharacter: number } }> {
		const client = await this.#ensure()
		const file = this.#fileOf(name)
		if (!this.#versions.has(file)) return { text: '' }
		const result = (await client.request('textDocument/hover', { textDocument: { uri: this.#uri(file) }, position: { line, character } })) as { readonly contents?: unknown; readonly range?: LspRange } | null
		const text = hoverText(result?.contents)
		const range = result?.range
		return range === undefined ? { text } : { text, range: { line: range.start.line, character: range.start.character, endLine: range.end.line, endCharacter: range.end.character } }
	}

	async diagnostics(name: string): Promise<DiagnosticOut[]> {
		const client = this.#current
		const file = this.#fileOf(name)
		if (client === undefined || !this.#versions.has(file)) return []
		let raw: readonly RawDiagnostic[] | undefined
		try {
			const result = await client.request('textDocument/diagnostic', { textDocument: { uri: this.#uri(file) } })
			const items = (result as { readonly items?: readonly RawDiagnostic[] } | null)?.items
			if (items !== undefined) raw = items
		} catch {
			// The server only publishes diagnostics: use those.
		}
		raw ??= client.diagnostics.get(basename(file)) ?? []
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
		// The script stays in the scratch project as a mirrored file until the next project sync.
		this.#paths.delete(name)
	}

	dispose(): void {
		this.#current?.dispose()
		this.#current = undefined
		this.#client = undefined
		this.#versions.clear()
		this.#texts.clear()
	}

	/**
	 * Handles one request from the editor.
	 */
	async handle(action: string, body: unknown): Promise<Record<string, unknown>> {
		const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
		try {
			if (action === 'project') {
				const list = input['files']
				if (!Array.isArray(list) || list.length > MAX_PROJECT_FILES) return { ok: false, error: 'Too many scripts' }
				const files: { path: string; text: string }[] = []
				let total = 0
				for (const item of list as readonly { readonly path?: unknown; readonly text?: unknown }[]) {
					const path = cleanScriptPath(item.path)
					if (path === undefined || typeof item.text !== 'string' || item.text.length > MAX_SCRIPT_BYTES) return { ok: false, error: 'Invalid script in project' }
					total += item.text.length
					files.push({ path, text: item.text })
				}
				if (total > MAX_PROJECT_BYTES) return { ok: false, error: 'The scripts are too large' }
				await this.syncProject(files)
				return { ok: true }
			}
			const name = input['name']
			if (typeof name !== 'string' || !NAME.test(name)) return { ok: false, error: 'Invalid document name' }
			const line = input['line']
			const character = input['character']
			const hasPosition = typeof line === 'number' && Number.isInteger(line) && line >= 0 && typeof character === 'number' && Number.isInteger(character) && character >= 0
			switch (action) {
				case 'sync': {
					const text = input['text']
					const rawPath = input['path']
					const path = rawPath === undefined ? undefined : cleanScriptPath(rawPath)
					if (typeof text !== 'string' || text.length > MAX_SCRIPT_BYTES || (rawPath !== undefined && path === undefined)) return { ok: false, error: 'Invalid text or path' }
					await this.sync(name, text, path)
					return { ok: true }
				}
				case 'completion':
					return hasPosition ? { ok: true, items: await this.completion(name, line, character) } : { ok: false, error: 'Invalid position' }
				case 'hover':
					return hasPosition ? { ok: true, ...(await this.hover(name, line, character)) } : { ok: false, error: 'Invalid position' }
				case 'definition':
					return hasPosition ? { ok: true, result: await this.definition(name, line, character) } : { ok: false, error: 'Invalid position' }
				case 'signature':
					return hasPosition ? { ok: true, result: await this.signature(name, line, character) } : { ok: false, error: 'Invalid position' }
				case 'format':
					return { ok: true, edits: await this.format(name) }
				case 'rename': {
					const newName = input['newName']
					if (!hasPosition || typeof newName !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(newName)) return { ok: false, error: 'Invalid name' }
					return { ok: true, edits: await this.rename(name, line, character, newName) }
				}
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
			this.#texts.clear()
		}
		this.#client = this.#boot()
		return this.#client
	}

	async #boot(): Promise<LspClient> {
		await mkdir(this.#directory, { recursive: true })
		await rm(join(this.#directory, 'project'), { recursive: true, force: true })
		await copyFile(join(this.#root, 'packages/scripting/src/api.ts'), join(this.#directory, 'strata.ts'))
		await writeFile(
			join(this.#directory, 'tsconfig.json'),
			JSON.stringify({
				compilerOptions: { target: 'ES2022', module: 'esnext', moduleResolution: 'bundler', allowImportingTsExtensions: true, strict: true, noEmit: true, skipLibCheck: true, noUncheckedIndexedAccess: true, types: [], paths: { strata: ['./strata.ts'] } },
				include: ['*.ts', 'project/**/*.ts']
			})
		)
		const client = LspClient.start(this.#root)
		await client.initialize(pathToFileURL(this.#directory).href)
		this.#current = client
		return client
	}

	async definition(name: string, line: number, character: number): Promise<DefinitionOut | undefined> {
		const client = await this.#ensure()
		const file = this.#fileOf(name)
		if (!this.#versions.has(file)) return undefined
		const result = await client.request('textDocument/definition', { textDocument: { uri: this.#uri(file) }, position: { line, character } })
		const first = (Array.isArray(result) ? result[0] : result) as { readonly uri?: string; readonly targetUri?: string; readonly range?: LspRange; readonly targetSelectionRange?: LspRange } | null | undefined
		const uri = first?.uri ?? first?.targetUri
		const range = first?.range ?? first?.targetSelectionRange
		if (uri === undefined || range === undefined) return undefined
		const target = this.#relative(uri)
		if (target === file) return { local: { line: range.start.line, character: range.start.character } }
		let text = ''
		if (target !== undefined) {
			try {
				text = (await readFile(join(this.#directory, target), 'utf8')).split('\n').slice(range.start.line, range.start.line + 10).join('\n')
			} catch {
				// The definition is in a file that is not in the scratch project.
			}
		}
		return { external: { file: target?.replace(/^project\//, '') ?? uriFile(uri), text } }
	}

	async signature(name: string, line: number, character: number): Promise<SignatureOut | undefined> {
		const client = await this.#ensure()
		const file = this.#fileOf(name)
		if (!this.#versions.has(file)) return undefined
		const result = (await client.request('textDocument/signatureHelp', {
			textDocument: { uri: this.#uri(file) },
			position: { line, character },
			context: { triggerKind: 1, isRetrigger: false }
		})) as { readonly signatures?: readonly { readonly label: string; readonly documentation?: unknown; readonly activeParameter?: number; readonly parameters?: readonly { readonly label: string | readonly [number, number] }[] }[]; readonly activeSignature?: number; readonly activeParameter?: number } | null
		const signature = result?.signatures?.[result.activeSignature ?? 0]
		if (signature === undefined) return undefined
		const parameters = (signature.parameters ?? []).map((parameter) =>
			typeof parameter.label === 'string' ? parameter.label : signature.label.slice(parameter.label[0], parameter.label[1])
		)
		return { label: signature.label, documentation: textOf(signature.documentation), parameters, active: signature.activeParameter ?? result?.activeParameter ?? 0 }
	}

	async format(name: string): Promise<TextEditOut[]> {
		const client = await this.#ensure()
		const file = this.#fileOf(name)
		if (!this.#versions.has(file)) return []
		return toEdits(await client.request('textDocument/formatting', { textDocument: { uri: this.#uri(file) }, options: { tabSize: 2, insertSpaces: false } }))
	}

	async rename(name: string, line: number, character: number, newName: string): Promise<TextEditOut[]> {
		const client = await this.#ensure()
		const file = this.#fileOf(name)
		if (!this.#versions.has(file)) return []
		const result = (await client.request('textDocument/rename', { textDocument: { uri: this.#uri(file) }, position: { line, character }, newName })) as {
			readonly changes?: Readonly<Record<string, unknown>>
			readonly documentChanges?: readonly { readonly textDocument?: { readonly uri: string }; readonly edits?: unknown }[]
		} | null
		const edits: TextEditOut[] = []
		let foreign = false
		const take = (uri: string, list: unknown): void => {
			if (this.#relative(uri) === file) edits.push(...toEdits(list))
			else if (Array.isArray(list) && list.length > 0) foreign = true
		}
		for (const [uri, list] of Object.entries(result?.changes ?? {})) take(uri, list)
		for (const change of result?.documentChanges ?? []) if (change.textDocument !== undefined) take(change.textDocument.uri, change.edits)
		if (foreign) throw new Error('This name is used in other scripts. Renaming across files is not supported yet.')
		return edits
	}
}
