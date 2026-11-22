/**
 * Scores how well a query matches a label, or returns undefined. Prefixes and word starts win over scattered letters.
 */
export function fuzzyScore(query: string, label: string): number | undefined {
	if (query === '') return 0
	const wanted = query.toLowerCase()
	const lower = label.toLowerCase()
	if (lower === wanted) return 1000
	if (lower.startsWith(wanted)) return 900 - (label.length - query.length)
	let score = 0
	let index = 0
	let previous = -2
	for (const letter of wanted) {
		const found = lower.indexOf(letter, index)
		if (found < 0) return undefined
		const boundary = found === 0 || /[^a-z0-9]/i.test(label.charAt(found - 1)) || label.charAt(found) !== lower.charAt(found)
		score += boundary ? 10 : 1
		if (found === previous + 1) score += 5
		previous = found
		index = found + 1
	}
	return score - Math.floor(label.length / 4)
}
