export interface Point {
	readonly x: number
	readonly y: number
}
/** A rectangle by its lower-left corner and size. */
export interface Rect extends Point {
	readonly w: number
	readonly h: number
}
export interface Circle extends Point {
	readonly r: number
}

export const rectsOverlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
export const circlesOverlap = (a: Circle, b: Circle): boolean => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= (a.r + b.r) ** 2
export const pointInRect = (p: Point, r: Rect): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
export const pointInCircle = (p: Point, c: Circle): boolean => (p.x - c.x) ** 2 + (p.y - c.y) ** 2 <= c.r * c.r
export function circleRectOverlap(c: Circle, r: Rect): boolean {
	const x = Math.min(Math.max(c.x, r.x), r.x + r.w)
	const y = Math.min(Math.max(c.y, r.y), r.y + r.h)
	return (c.x - x) ** 2 + (c.y - y) ** 2 <= c.r * c.r
}
export function rectIntersection(a: Rect, b: Rect): Rect | undefined {
	const x = Math.max(a.x, b.x)
	const y = Math.max(a.y, b.y)
	const w = Math.min(a.x + a.w, b.x + b.w) - x
	const h = Math.min(a.y + a.h, b.y + b.h) - y
	return w > 0 && h > 0 ? { x, y, w, h } : undefined
}
export function rectUnion(a: Rect, b: Rect): Rect {
	const x = Math.min(a.x, b.x)
	const y = Math.min(a.y, b.y)
	return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
export const expandRect = (r: Rect, margin: number): Rect => ({ x: r.x - margin, y: r.y - margin, w: r.w + margin * 2, h: r.h + margin * 2 })

export function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
	let inside = false
	for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
		const a = polygon[index]
		const b = polygon[previous]
		if (a === undefined || b === undefined) continue
		if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
	}
	return inside
}
export function polygonArea(polygon: readonly Point[]): number {
	let area = 0
	for (let index = 0; index < polygon.length; index++) {
		const a = polygon[index]
		const b = polygon[(index + 1) % polygon.length]
		if (a !== undefined && b !== undefined) area += a.x * b.y - b.x * a.y
	}
	return Math.abs(area) / 2
}
export function polygonCentroid(polygon: readonly Point[]): Point {
	if (polygon.length === 0) return { x: 0, y: 0 }
	return { x: polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length, y: polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length }
}

const orient = (a: Point, b: Point, c: Point): number => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
	return orient(a1, a2, b1) !== orient(a1, a2, b2) && orient(b1, b2, a1) !== orient(b1, b2, a2)
}
/** Where two infinite lines cross, or undefined when they are parallel. */
export function lineIntersection(a1: Point, a2: Point, b1: Point, b2: Point): Point | undefined {
	const d = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x)
	if (d === 0) return undefined
	const t = ((a1.x - b1.x) * (b1.y - b2.y) - (a1.y - b1.y) * (b1.x - b2.x)) / d
	return { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y) }
}
export function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
	const dx = b.x - a.x
	const dy = b.y - a.y
	const lengthSq = dx * dx + dy * dy
	const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
	return { x: a.x + dx * t, y: a.y + dy * t }
}
export function distanceToSegment(p: Point, a: Point, b: Point): number {
	const q = closestPointOnSegment(p, a, b)
	return Math.hypot(p.x - q.x, p.y - q.y)
}
/** Distance along a ray (direction need not be normalized) to a circle, or undefined when it misses. */
export function rayCircle(origin: Point, direction: Point, c: Circle): number | undefined {
	const fx = origin.x - c.x
	const fy = origin.y - c.y
	const a = direction.x ** 2 + direction.y ** 2
	const b = 2 * (fx * direction.x + fy * direction.y)
	const disc = b * b - 4 * a * (fx * fx + fy * fy - c.r * c.r)
	if (a === 0 || disc < 0) return undefined
	const t = (-b - Math.sqrt(disc)) / (2 * a)
	return t >= 0 ? t : undefined
}
export function rayRect(origin: Point, direction: Point, r: Rect): number | undefined {
	let near = -Infinity
	let far = Infinity
	for (const [o, d, min, max] of [[origin.x, direction.x, r.x, r.x + r.w], [origin.y, direction.y, r.y, r.y + r.h]] as const) {
		if (d === 0) {
			if (o < min || o > max) return undefined
			continue
		}
		const t1 = (min - o) / d
		const t2 = (max - o) / d
		near = Math.max(near, Math.min(t1, t2))
		far = Math.min(far, Math.max(t1, t2))
	}
	return near <= far && far >= 0 ? Math.max(0, near) : undefined
}
export function convexHull(points: readonly Point[]): Point[] {
	const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
	if (sorted.length < 3) return sorted
	const build = (list: readonly Point[]): Point[] => {
		const hull: Point[] = []
		for (const p of list) {
			while (hull.length >= 2) {
				const a = hull[hull.length - 2]
				const b = hull[hull.length - 1]
				if (a !== undefined && b !== undefined && orient(a, b, p) <= 0) hull.pop()
				else break
			}
			hull.push(p)
		}
		hull.pop()
		return hull
	}
	return [...build(sorted), ...build([...sorted].reverse())]
}
