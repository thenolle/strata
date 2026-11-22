import type { Point } from './geometry.ts'

export const bezier2 = (p0: number, p1: number, p2: number, t: number): number => (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2
export const bezier3 = (p0: number, p1: number, p2: number, p3: number, t: number): number => (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3
/** A point on a Bezier curve of any degree, from its control points (de Casteljau). */
export function bezierPoint(points: readonly Point[], t: number): Point {
	let layer = [...points]
	while (layer.length > 1) {
		layer = layer.slice(1).map((next, index) => {
			const previous = layer[index] ?? next
			return { x: previous.x + (next.x - previous.x) * t, y: previous.y + (next.y - previous.y) * t }
		})
	}
	return layer[0] ?? { x: 0, y: 0 }
}
export const hermite = (p0: number, m0: number, p1: number, m1: number, t: number): number => {
	const t2 = t * t
	const t3 = t2 * t
	return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1
}
/** Uniform Catmull-Rom spline between p1 and p2. */
export const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number): number =>
	0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
/** A smooth path through points. t runs from 0 at the first point to 1 at the last. */
export function splinePoint(points: readonly Point[], t: number): Point {
	const last = points.length - 1
	if (last < 1) return points[0] ?? { x: 0, y: 0 }
	const scaled = Math.min(Math.max(t, 0), 1) * last
	const index = Math.min(Math.floor(scaled), last - 1)
	const at = (i: number): Point => points[Math.min(Math.max(i, 0), last)] ?? { x: 0, y: 0 }
	const local = scaled - index
	return { x: catmullRom(at(index - 1).x, at(index).x, at(index + 1).x, at(index + 2).x, local), y: catmullRom(at(index - 1).y, at(index).y, at(index + 1).y, at(index + 2).y, local) }
}
export function polylineLength(points: readonly Point[]): number {
	let total = 0
	for (let index = 1; index < points.length; index++) {
		const a = points[index - 1]
		const b = points[index]
		if (a !== undefined && b !== undefined) total += Math.hypot(b.x - a.x, b.y - a.y)
	}
	return total
}
/** The point a given distance along a polyline, stopping at the end. */
export function pointAlong(points: readonly Point[], distance: number): Point {
	let remaining = Math.max(0, distance)
	for (let index = 1; index < points.length; index++) {
		const a = points[index - 1]
		const b = points[index]
		if (a === undefined || b === undefined) continue
		const length = Math.hypot(b.x - a.x, b.y - a.y)
		if (remaining <= length) return length === 0 ? a : { x: a.x + ((b.x - a.x) * remaining) / length, y: a.y + ((b.y - a.y) * remaining) / length }
		remaining -= length
	}
	return points[points.length - 1] ?? { x: 0, y: 0 }
}
