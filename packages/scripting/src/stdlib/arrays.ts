export function range(start: number, end: number, step = 1): number[] {
	const out: number[] = []
	if (step === 0) return out
	for (let value = start; step > 0 ? value < end : value > end; value += step) out.push(value)
	return out
}
export function chunk<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = []
	for (let index = 0; index < items.length; index += Math.max(1, size)) out.push(items.slice(index, index + Math.max(1, size)))
	return out
}
export const zip = <A, B>(a: readonly A[], b: readonly B[]): [A, B][] => Array.from({ length: Math.min(a.length, b.length) }, (_, index) => [a[index] as A, b[index] as B])
export const unique = <T>(items: readonly T[]): T[] => [...new Set(items)]
export function uniqueBy<T, K>(items: readonly T[], key: (item: T) => K): T[] {
	const seen = new Set<K>()
	return items.filter((item) => {
		const k = key(item)
		if (seen.has(k)) return false
		seen.add(k)
		return true
	})
}
export function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
	const groups = new Map<K, T[]>()
	for (const item of items) {
		const k = key(item)
		groups.set(k, [...(groups.get(k) ?? []), item])
	}
	return groups
}
export const countBy = <T, K>(items: readonly T[], key: (item: T) => K): Map<K, number> => new Map([...groupBy(items, key)].map(([k, list]) => [k, list.length]))
export const sortBy = <T>(items: readonly T[], key: (item: T) => number | string): T[] => [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
export function minBy<T>(items: readonly T[], key: (item: T) => number): T | undefined {
	let best: T | undefined
	for (const item of items) if (best === undefined || key(item) < key(best)) best = item
	return best
}
export function maxBy<T>(items: readonly T[], key: (item: T) => number): T | undefined {
	let best: T | undefined
	for (const item of items) if (best === undefined || key(item) > key(best)) best = item
	return best
}
export const sumBy = <T>(items: readonly T[], key: (item: T) => number): number => items.reduce((total, item) => total + key(item), 0)
export const partition = <T>(items: readonly T[], test: (item: T) => boolean): [T[], T[]] => [items.filter(test), items.filter((item) => !test(item))]
export const flatten = <T>(lists: readonly (readonly T[])[]): T[] => lists.flatMap((list) => [...list])
export const last = <T>(items: readonly T[]): T | undefined => items[items.length - 1]
export const take = <T>(items: readonly T[], count: number): T[] => items.slice(0, Math.max(0, count))
export const drop = <T>(items: readonly T[], count: number): T[] => items.slice(Math.max(0, count))
export function rotate<T>(items: readonly T[], by: number): T[] {
	if (items.length === 0) return []
	const shift = ((by % items.length) + items.length) % items.length
	return [...items.slice(shift), ...items.slice(0, shift)]
}
/** Every run of size consecutive items: [1,2,3] with size 2 gives [1,2] and [2,3]. */
export const windowed = <T>(items: readonly T[], size: number): T[][] => Array.from({ length: Math.max(0, items.length - size + 1) }, (_, index) => items.slice(index, index + size))
export const intersection = <T>(a: readonly T[], b: readonly T[]): T[] => unique(a).filter((item) => b.includes(item))
export const difference = <T>(a: readonly T[], b: readonly T[]): T[] => unique(a).filter((item) => !b.includes(item))
export const union = <T>(a: readonly T[], b: readonly T[]): T[] => unique([...a, ...b])
