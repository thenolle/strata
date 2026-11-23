/** @jsxImportSource @gambrel/view */
import { onCleanup, signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import { findAll, type FindOptions } from './ide/editing.ts'
import { dialogs } from './dialogs.tsx'

interface Hit {
	readonly path: string
	readonly line: number
	readonly character: number
	readonly preview: string
}

/**
 * Searches all scripts, shows matches by file, and can replace them everywhere.
 */
export function SearchPanel(props: {
	readonly texts: () => Promise<Record<string, string>>
	readonly onOpen: (path: string, line: number, character: number) => void
	readonly onReplace: (changes: ReadonlyMap<string, string>) => void
}): Child {
	const query = signal('')
	const replacement = signal('')
	const options = signal<FindOptions>({ caseSensitive: false, wholeWord: false, regex: false })
	const hits = signal<readonly Hit[]>([])
	let files: Record<string, string> = {}
	let timer: ReturnType<typeof setTimeout> | undefined

	const search = async (): Promise<void> => {
		files = await props.texts()
		const found: Hit[] = []
		if (query.peek() !== '') {
			for (const [path, source] of Object.entries(files)) {
				const lines = source.split('\n')
				const starts = [0]
				for (let index = 0; index < source.length; index++) if (source.charCodeAt(index) === 10) starts.push(index + 1)
				let row = 0
				for (const match of findAll(source, query.peek(), options.peek())) {
					while (row + 1 < starts.length && (starts[row + 1] ?? Infinity) <= match.from) row++
					found.push({ path, line: row, character: match.from - (starts[row] ?? 0), preview: (lines[row] ?? '').trim().slice(0, 140) })
					if (found.length >= 500) break
				}
				if (found.length >= 500) break
			}
		}
		hits.set(found)
	}
	const schedule = (): void => {
		clearTimeout(timer)
		timer = setTimeout(() => void search(), 250)
	}
	onCleanup(() => clearTimeout(timer))

	const replaceAll = async (): Promise<void> => {
		const paths = new Set(hits.peek().map((hit) => hit.path))
		if (paths.size === 0) return
		const count = hits.peek().length
		if (!(await dialogs.confirm(`Replace ${count} match${count === 1 ? '' : 'es'} in ${paths.size} script${paths.size === 1 ? '' : 's'}?`, { title: 'Replace in all scripts', okLabel: 'Replace', danger: true }))) return
		const changes = new Map<string, string>()
		for (const path of paths) {
			const source = files[path] ?? ''
			let result = ''
			let cursor = 0
			for (const match of findAll(source, query.peek(), options.peek())) {
				result += source.slice(cursor, match.from) + replacement.peek()
				cursor = match.to
			}
			changes.set(path, result + source.slice(cursor))
		}
		props.onReplace(changes)
		hits.set([])
	}

	const field = (placeholder: string, target: { set(value: string): void }): Child => (
		<input
			type="text"
			placeholder={placeholder}
			ref={(element: Element) => {
				const input = element as HTMLInputElement
				const onInput = (): void => {
					target.set(input.value)
					schedule()
				}
				input.addEventListener('input', onInput)
				onCleanup(() => input.removeEventListener('input', onInput))
			}}
		/>
	)
	const toggle = (label: string, title: string, key: keyof FindOptions): Child => (
		<button
			type="button"
			class="wb-panel-tab"
			title={title}
			data-active={() => String(options()[key])}
			onClick={() => {
				options.update((current) => ({ ...current, [key]: !current[key] }))
				schedule()
			}}
		>
			{label}
		</button>
	)

	return (
		<div class="wb-search">
			<strong>Search</strong>
			{field('Find in all scripts', query)}
			<div class="wb-search-row">
				{toggle('Aa', 'Match case', 'caseSensitive')}
				{toggle('ab', 'Whole word', 'wholeWord')}
				{toggle('.*', 'Regular expression', 'regex')}
			</div>
			{field('Replace with', replacement)}
			<button type="button" class="wb-button" onClick={() => void replaceAll()}>Replace all</button>
			{() => {
				const list = hits()
				if (query() === '') return <p class="panel-empty">Type to search every script.</p>
				if (list.length === 0) return <p class="panel-empty">No results</p>
				const groups = new Map<string, Hit[]>()
				for (const hit of list) groups.set(hit.path, [...(groups.get(hit.path) ?? []), hit])
				return (
					<ul class="search-results">
						{[...groups].map(([path, items]) => (
							<li class="search-file">
								<div class="search-path">{`${path} (${items.length})`}</div>
								<ul>
									{items.map((hit) => (
										<li class="search-hit" onClick={() => props.onOpen(hit.path, hit.line, hit.character)}>
											{`${hit.line + 1}: ${hit.preview}`}
										</li>
									))}
								</ul>
							</li>
						))}
					</ul>
				)
			}}
		</div>
	)
}
