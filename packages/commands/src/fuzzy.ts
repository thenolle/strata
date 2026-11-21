const MATCH_SCORE = 10
const ADJACENT_BONUS = 15
const BOUNDARY_BONUS = 20
const GAP_PENALTY = 0.5
const LEADING_PENALTY = 0.3
const NEG = Number.NEGATIVE_INFINITY

export interface FuzzyMatch {
	readonly score: number
	readonly positions: readonly number[]
}

function isBoundary(text: string, index: number): boolean {
	if (index === 0) return true
	const previous = text.charAt(index - 1)
	const current = text.charAt(index)
	const previousIsLetterOrDigit = /[A-Za-z0-9]/.test(previous)
	const camelStep = previous !== previous.toUpperCase() && current !== current.toLowerCase()
	return !previousIsLetterOrDigit || camelStep
}

/**
 * Case-insensitive subsequence match that scores the best alignment: word starts and consecutive characters score higher,
 * gaps and late starts lower. Returns undefined when the query is not a subsequence of the text.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | undefined {
	const n = query.length
	const m = text.length
	if (n === 0) return { score: 0, positions: [] }
	if (n > m) return undefined
	const lowerQuery = query.toLowerCase()
	const lowerText = text.toLowerCase()
	if (lowerQuery.length !== n || lowerText.length !== m) return undefined
	const scores = Array.from({ length: n }, () => new Float64Array(m).fill(NEG))
	const sources = Array.from({ length: n }, () => new Int32Array(m).fill(-1))
	for (let i = 0; i < n; i++) {
		const row = scores[i] as Float64Array
		const sourceRow = sources[i] as Int32Array
		const previous = i > 0 ? (scores[i - 1] as Float64Array) : undefined
		let runningScore = NEG
		let runningIndex = -1
		for (let j = 0; j < m; j++) {
			if (previous !== undefined && j >= 2) {
				const candidate = (previous[j - 2] as number) + GAP_PENALTY * (j - 2)
				if (candidate > runningScore) {
					runningScore = candidate
					runningIndex = j - 2
				}
			}
			if (lowerText.charAt(j) !== lowerQuery.charAt(i)) continue
			const gain = MATCH_SCORE + (text.charAt(j) === query.charAt(i) ? 1 : 0) + (isBoundary(text, j) ? BOUNDARY_BONUS : 0)
			if (previous === undefined) {
				row[j] = gain - Math.min(j, 12) * LEADING_PENALTY
				continue
			}
			let best = NEG
			let source = -1
			const adjacent = j > 0 ? (previous[j - 1] as number) : NEG
			if (adjacent > NEG) {
				best = adjacent + ADJACENT_BONUS
				source = j - 1
			}
			if (runningIndex >= 0 && runningScore > NEG) {
				const viaGap = runningScore - GAP_PENALTY * (j - 1)
				if (viaGap > best) {
					best = viaGap
					source = runningIndex
				}
			}
			if (source >= 0) {
				row[j] = best + gain
				sourceRow[j] = source
			}
		}
	}
	const last = scores[n - 1] as Float64Array
	let end = -1
	let top = NEG
	for (let j = 0; j < m; j++) {
		const value = last[j] as number
		if (value > top) {
			top = value
			end = j
		}
	}
	if (end < 0) return undefined
	const positions: number[] = []
	let cursor = end
	for (let i = n - 1; i >= 0; i--) {
		positions.push(cursor)
		cursor = (sources[i] as Int32Array)[cursor] as number
	}
	positions.reverse()
	return { score: top - m * 0.05, positions }
}

export interface QuickPickItem<T> {
	readonly label: string
	readonly description?: string
	readonly detail?: string
	readonly value: T
}

export interface QuickPickResult<T> {
	readonly item: QuickPickItem<T>
	readonly score: number
	readonly labelPositions: readonly number[]
}

/**
 * State of a searchable list such as the command palette or quick open: the query, the ranked results and the highlighted row.
 */
export class QuickPickModel<T> {
	readonly #items: readonly QuickPickItem<T>[]
	readonly #limit: number
	#query = ''
	#results: readonly QuickPickResult<T>[]
	#index = 0

	constructor(items: readonly QuickPickItem<T>[], limit = 50) {
		this.#items = items
		this.#limit = limit
		this.#results = this.#rank('')
	}

	get query(): string {
		return this.#query
	}

	get results(): readonly QuickPickResult<T>[] {
		return this.#results
	}

	get index(): number {
		return this.#index
	}

	setQuery(query: string): void {
		this.#query = query
		this.#results = this.#rank(query.trim())
		this.#index = 0
	}

	move(delta: number): void {
		const count = this.#results.length
		if (count === 0) return
		this.#index = (((this.#index + delta) % count) + count) % count
	}

	selected(): QuickPickItem<T> | undefined {
		return this.#results[this.#index]?.item
	}

	#rank(query: string): QuickPickResult<T>[] {
		if (query === '') return this.#items.slice(0, this.#limit).map((item) => ({ item, score: 0, labelPositions: [] }))
		const ranked: QuickPickResult<T>[] = []
		for (const item of this.#items) {
			const label = fuzzyMatch(query, item.label)
			if (label !== undefined) {
				ranked.push({ item, score: label.score, labelPositions: label.positions })
				continue
			}
			const detail = item.detail === undefined ? undefined : fuzzyMatch(query, item.detail)
			if (detail !== undefined) ranked.push({ item, score: detail.score - 50, labelPositions: [] })
		}
		ranked.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
		return ranked.slice(0, this.#limit)
	}
}
