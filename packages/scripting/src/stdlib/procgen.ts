import { Grid2D } from './collections.ts'
import type { Point } from './geometry.ts'
import type { Random } from './random.ts'

/**
 * Evenly spread random points that are never closer than minDistance (Bridson's method). Good for trees, props and spawns.
 */
export function poissonDisk(width: number, height: number, minDistance: number, random: Random, tries = 30): Point[] {
	const cell = minDistance / Math.SQRT2
	const cols = Math.ceil(width / cell)
	const rows = Math.ceil(height / cell)
	const grid = new Int32Array(cols * rows).fill(-1)
	const points: Point[] = []
	const active: number[] = []
	const add = (point: Point): void => {
		points.push(point)
		active.push(points.length - 1)
		grid[Math.floor(point.y / cell) * cols + Math.floor(point.x / cell)] = points.length - 1
	}
	add({ x: random.float(0, width), y: random.float(0, height) })
	while (active.length > 0) {
		const pick = random.int(0, active.length - 1)
		const base = points[active[pick] ?? 0]
		let found = false
		for (let attempt = 0; base !== undefined && attempt < tries && !found; attempt++) {
			const angle = random.angle()
			const radius = random.float(minDistance, minDistance * 2)
			const candidate = { x: base.x + Math.cos(angle) * radius, y: base.y + Math.sin(angle) * radius }
			if (candidate.x < 0 || candidate.y < 0 || candidate.x >= width || candidate.y >= height) continue
			const cx = Math.floor(candidate.x / cell)
			const cy = Math.floor(candidate.y / cell)
			let free = true
			for (let y = Math.max(0, cy - 2); y <= Math.min(rows - 1, cy + 2) && free; y++) {
				for (let x = Math.max(0, cx - 2); x <= Math.min(cols - 1, cx + 2); x++) {
					const index = grid[y * cols + x] ?? -1
					const other = index < 0 ? undefined : points[index]
					if (other !== undefined && Math.hypot(other.x - candidate.x, other.y - candidate.y) < minDistance) {
						free = false
						break
					}
				}
			}
			if (free) {
				add(candidate)
				found = true
			}
		}
		if (!found) {
			active[pick] = active[active.length - 1] ?? 0
			active.pop()
		}
	}
	return points
}

/**
 * A maze of cellsX by cellsY rooms on a (2n+1) grid where true is wall. Every room is reachable from every other.
 * The first room is at (1, 1).
 */
export function maze(cellsX: number, cellsY: number, random: Random): Grid2D<boolean> {
	const grid = new Grid2D<boolean>(cellsX * 2 + 1, cellsY * 2 + 1, true)
	const seen = new Set<number>([0])
	const stack: [number, number][] = [[0, 0]]
	grid.set(1, 1, false)
	while (stack.length > 0) {
		const [cx, cy] = stack[stack.length - 1] ?? [0, 0]
		const options = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).filter(([dx, dy]) => {
			const nx = cx + dx
			const ny = cy + dy
			return nx >= 0 && ny >= 0 && nx < cellsX && ny < cellsY && !seen.has(ny * cellsX + nx)
		})
		const choice = random.pick(options)
		if (choice === undefined) {
			stack.pop()
			continue
		}
		const [dx, dy] = choice
		const nx = cx + dx
		const ny = cy + dy
		seen.add(ny * cellsX + nx)
		grid.set(cx * 2 + 1 + dx, cy * 2 + 1 + dy, false)
		grid.set(nx * 2 + 1, ny * 2 + 1, false)
		stack.push([nx, ny])
	}
	return grid
}

/** Cave-like terrain from cellular automata. True is wall, and the border is always wall. */
export function caves(width: number, height: number, random: Random, wallChance = 0.45, steps = 4): Grid2D<boolean> {
	let grid = new Grid2D<boolean>(width, height, true)
	for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) grid.set(x, y, random.chance(wallChance))
	for (let step = 0; step < steps; step++) {
		const next = new Grid2D<boolean>(width, height, true)
		for (let y = 1; y < height - 1; y++) {
			for (let x = 1; x < width - 1; x++) {
				let walls = 0
				for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx !== 0 || dy !== 0) && grid.get(x + dx, y + dy) !== false) walls++
				next.set(x, y, walls >= 5 || (walls === 4 && grid.get(x, y) === true))
			}
		}
		grid = next
	}
	return grid
}

/** A path of random steps, for wandering and erosion effects. */
export function randomWalk(steps: number, random: Random, stepSize = 1, start: Point = { x: 0, y: 0 }): Point[] {
	const path: Point[] = [start]
	let current = start
	for (let index = 0; index < steps; index++) {
		const angle = random.angle()
		current = { x: current.x + Math.cos(angle) * stepSize, y: current.y + Math.sin(angle) * stepSize }
		path.push(current)
	}
	return path
}
