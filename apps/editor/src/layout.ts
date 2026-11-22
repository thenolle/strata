const KEY = 'strata.layout'

export interface Layout {
	outline: number
	inspector: number
	assets: number
	ideSide: number
	ideProblems: number
}

export const DEFAULT_LAYOUT: Readonly<Layout> = { outline: 240, inspector: 280, assets: 170, ideSide: 280, ideProblems: 150 }

/**
 * Reads the saved panel sizes, ignoring anything that is not a sensible number.
 */
export function loadLayout(): Layout {
	const layout: Layout = { ...DEFAULT_LAYOUT }
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>
		for (const key of Object.keys(layout) as (keyof Layout)[]) {
			const value = saved[key]
			if (typeof value === 'number' && Number.isFinite(value) && value >= 60 && value <= 4000) layout[key] = value
		}
	} catch {
		// Unreadable storage: use the defaults.
	}
	return layout
}

export function saveLayout(layout: Layout): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(layout))
	} catch {
		// Storage may be unavailable; sizes are simply not remembered.
	}
}

/**
 * Publishes the panel sizes as CSS variables that the layout reads.
 */
export function applyLayout(root: HTMLElement, layout: Readonly<Layout>): void {
	root.style.setProperty('--outline-width', `${layout.outline}px`)
	root.style.setProperty('--inspector-width', `${layout.inspector}px`)
	root.style.setProperty('--assets-height', `${layout.assets}px`)
	root.style.setProperty('--wb-side', `${layout.ideSide}px`)
	root.style.setProperty('--wb-problems', `${layout.ideProblems}px`)
}
