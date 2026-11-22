/** @jsxImportSource @gambrel/view */
import { onCleanup, signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import type { Guid } from '@strata/core'
import type { EditorSession } from '@strata/editor-core'
import { graph as G } from '@strata/scripting'
import { GraphView, parseGraph } from './graph-view.ts'

/**
 * The graph editor: a canvas for the nodes, live checking, the generated code, and Save and compile, which also writes the script next to the graph.
 */
export function GraphEditor(props: { readonly session: EditorSession; readonly asset: Guid; readonly onClose: () => void }): Child {
	const assets = props.session.project.assets
	const name = assets.get(props.asset)?.name ?? 'Graph'
	const status = signal('Loading…')
	const problems = signal<readonly string[]>([])
	const dirty = signal(false)
	const variables = signal<readonly G.GraphVariable[]>([])
	const code = signal('')
	const showCode = signal(false)
	let view: GraphView | undefined
	let timer: ReturnType<typeof setTimeout> | undefined

	const className = (): string => {
		const base = name.replace(/\.graph$/i, '').replace(/[^A-Za-z0-9_]/g, '_')
		return /^[A-Za-z_]/.test(base) ? base : `G_${base}`
	}
	const refreshVariables = (): void => variables.set(view === undefined ? [] : [...view.variables])

	/** Compiles the graph as it is and marks the nodes that have problems. */
	const check = (): void => {
		if (view === undefined) return
		const data = view.toData()
		const compiled = G.compileGraph(data, className())
		if (compiled.ok) {
			problems.set([])
			code.set(compiled.code)
			view.markErrors(new Set())
			return
		}
		problems.set(compiled.errors)
		const known = new Set(data.nodes.map((node) => node.id))
		const bad = new Set<string>()
		for (const message of compiled.errors) for (const match of message.matchAll(/"([A-Za-z_]\w*)"|^([A-Za-z_]\w*):/g)) {
			const id = match[1] ?? match[2]
			if (id !== undefined && known.has(id)) bad.add(id)
		}
		view.markErrors(bad)
	}
	const schedule = (): void => {
		dirty.set(true)
		clearTimeout(timer)
		timer = setTimeout(check, 400)
	}
	onCleanup(() => clearTimeout(timer))

	const load = async (host: HTMLElement): Promise<void> => {
		const bytes = await assets.read(props.asset)
		if (!bytes.ok) {
			status.set(bytes.error.message)
			return
		}
		const data = parseGraph(new TextDecoder().decode(bytes.value))
		if (data === undefined) {
			status.set('This graph file is damaged')
			return
		}
		view = new GraphView(data, schedule)
		host.append(view.element)
		refreshVariables()
		dirty.set(false)
		check()
		view.fit()
		status.set('Space or double-click adds a node. Drag from a pin into empty space to add a connected node.')
		view.element.focus()
	}

	const publish = async (source: string): Promise<string | undefined> => {
		const record = assets.get(props.asset)
		if (record === undefined) return 'The graph no longer exists'
		const scriptName = `${record.name}.ts`
		const bytes = new TextEncoder().encode(`// Generated from ${record.name}. Edit the graph: changes made here are overwritten.\n${source}`)
		const existing = assets.find(scriptName, record.folder)
		if (existing !== undefined && existing.kind !== 'script') return `${scriptName} exists and is not a script`
		const result = existing === undefined ? await assets.importAsset(scriptName, bytes, record.folder) : await assets.replaceContent(existing.id, bytes)
		return result.ok ? undefined : result.error.message
	}

	const save = async (): Promise<void> => {
		if (view === undefined) return
		const data = view.toData()
		const saved = await assets.replaceContent(props.asset, new TextEncoder().encode(JSON.stringify(data, null, 2)))
		if (!saved.ok) {
			status.set(saved.error.message)
			return
		}
		dirty.set(false)
		check()
		const compiled = G.compileGraph(data, className())
		if (!compiled.ok) {
			status.set('Saved, but the graph has problems')
			return
		}
		const failure = await publish(compiled.code)
		props.session.notifyAssetsChanged()
		status.set(failure ?? `Saved and compiled to ${name}.ts`)
	}

	const close = (): void => {
		if (dirty.peek() && !confirm('Discard the unsaved changes to this graph?')) return
		props.onClose()
	}

	const addVariable = (): void => {
		const variableName = prompt('Variable name')?.trim()
		if (variableName === undefined || variableName === '') return
		const type = prompt('Type: number, string or boolean', 'number')?.trim()
		if (type !== 'number' && type !== 'string' && type !== 'boolean') return
		const raw = prompt('Starting value', type === 'number' ? '0' : type === 'boolean' ? 'false' : '') ?? ''
		const value = type === 'number' ? Number(raw) || 0 : type === 'boolean' ? raw === 'true' : raw
		if (view?.addVariable({ name: variableName, type, value }) !== true) status.set('Use a new name made of letters, digits and underscores')
		refreshVariables()
	}

	return (
		<div class="gv-backdrop">
			<div
				class="gv-panel"
				role="dialog"
				aria-label={`Graph ${name}`}
				ref={(element: Element) => {
					const onKey = (event: KeyboardEvent): void => {
						if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
							event.preventDefault()
							void save()
						} else if (event.key === 'Escape' && (event.target as HTMLElement).closest('.ide-pick') === null) close()
					}
					const listener = onKey as EventListener
					element.addEventListener('keydown', listener)
					onCleanup(() => element.removeEventListener('keydown', listener))
				}}
			>
				<header class="gv-bar">
					<strong>{name}</strong>
					<span class="gv-status">{() => `${dirty() ? '● ' : ''}${status()}`}</span>
					<span class="spacer"></span>
					<button class="wb-button" type="button" title="Undo (Ctrl+Z)" onClick={() => view?.undo()}>
						Undo
					</button>
					<button class="wb-button" type="button" title="Redo (Ctrl+Y)" onClick={() => view?.redo()}>
						Redo
					</button>
					<button class="wb-button" type="button" title="Arrange the nodes in columns" onClick={() => view?.tidy()}>
						Tidy
					</button>
					<button class="wb-button" type="button" title="Show everything (F)" onClick={() => view?.fit()}>
						Fit
					</button>
					<button class="wb-button" type="button" title="Show the generated TypeScript" onClick={() => showCode.update((open) => !open)}>
						Code
					</button>
					<button class="wb-button" type="button" onClick={addVariable}>
						Add variable
					</button>
					<button class="wb-button" type="button" onClick={() => void save()}>
						Save and compile
					</button>
					<button class="wb-button" type="button" onClick={close}>
						Close
					</button>
				</header>
				<div class="gv-vars">
					{() =>
						variables().map((variable) => (
							<span class="gv-chip">
								{`${variable.name} (${variable.type}) = ${String(variable.value)}`}
								<button
									type="button"
									title="Remove variable"
									onClick={() => {
										view?.removeVariable(variable.name)
										refreshVariables()
									}}
								>
									×
								</button>
							</span>
						))
					}
				</div>
				<div class="gv-main">
					<div
						class="gv-host"
						ref={(element: Element) => {
							void load(element as HTMLElement)
						}}
					></div>
					{() => (showCode() ? <pre class="gv-code">{code() === '' ? 'Fix the problems to see the code.' : code()}</pre> : null)}
				</div>
				{() => (problems().length === 0 ? <p class="gv-ok">No problems</p> : <ul class="gv-problems">{problems().map((problem) => <li>{problem}</li>)}</ul>)}
			</div>
		</div>
	)
}
