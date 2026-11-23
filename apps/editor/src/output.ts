import { signal } from '@gambrel/reactivity'

export type OutputKind = 'info' | 'error'

export interface OutputLine {
	readonly kind: OutputKind
	readonly text: string
	readonly time: number
}

const MAX_LINES = 500
const entries = signal<readonly OutputLine[]>([])
const unseen = signal(0)

function push(kind: OutputKind, text: string): void {
	if (text.trim() === '') return
	entries.update((list) => [...list, { kind, text: text.slice(0, 2000), time: Date.now() }].slice(-MAX_LINES))
	if (kind === 'error') unseen.update((count) => count + 1)
}

/** Where the editor reports what happened: play logs, errors, saves and exports. Keeps the last 500 lines. */
export const output = {
	info: (text: string): void => push('info', text),
	error: (text: string): void => push('error', text),
	lines: (): readonly OutputLine[] => entries(),
	unseenErrors: (): number => unseen(),
	markSeen: (): void => unseen.set(0),
	clear: (): void => {
		entries.set([])
		unseen.set(0)
	}
}
