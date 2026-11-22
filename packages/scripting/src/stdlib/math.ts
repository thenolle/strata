export const PI = Math.PI
export const TAU = Math.PI * 2
export const EPSILON = 1e-6
export const DEG2RAD = Math.PI / 180
export const RAD2DEG = 180 / Math.PI

export const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)
export const clamp01 = (value: number): number => clamp(value, 0, 1)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const lerpClamped = (a: number, b: number, t: number): number => lerp(a, b, clamp01(t))
export const inverseLerp = (a: number, b: number, value: number): number => (a === b ? 0 : (value - a) / (b - a))
export const remap = (value: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number => lerp(toMin, toMax, inverseLerp(fromMin, fromMax, value))
export const smoothstep = (edge0: number, edge1: number, x: number): number => {
	const t = clamp01(inverseLerp(edge0, edge1, x))
	return t * t * (3 - 2 * t)
}
export const smootherstep = (edge0: number, edge1: number, x: number): number => {
	const t = clamp01(inverseLerp(edge0, edge1, x))
	return t * t * t * (t * (t * 6 - 15) + 10)
}
export const step = (edge: number, x: number): number => (x < edge ? 0 : 1)
export const sign = (value: number): number => (value > 0 ? 1 : value < 0 ? -1 : 0)
export const fract = (value: number): number => value - Math.floor(value)
/** Remainder that is never negative, unlike the % operator. */
export const mod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor
export const wrap = (value: number, min: number, max: number): number => (max === min ? min : min + mod(value - min, max - min))
export const pingPong = (t: number, length: number): number => length - Math.abs(mod(t, length * 2) - length)
/** Moves a value toward a target by at most maxDelta. */
export const approach = (current: number, target: number, maxDelta: number): number => (Math.abs(target - current) <= maxDelta ? target : current + Math.sign(target - current) * maxDelta)
/** Frame-rate independent smoothing: call with ctx.dt. Larger lambda is faster. */
export const damp = (current: number, target: number, lambda: number, dt: number): number => lerp(current, target, 1 - Math.exp(-lambda * dt))
export const wrapAngle = (radians: number): number => mod(radians + PI, TAU) - PI
export const deltaAngle = (from: number, to: number): number => wrapAngle(to - from)
export const lerpAngle = (a: number, b: number, t: number): number => a + deltaAngle(a, b) * t
export const toRadians = (degrees: number): number => degrees * DEG2RAD
export const toDegrees = (radians: number): number => radians * RAD2DEG
export const approximately = (a: number, b: number, epsilon = EPSILON): boolean => Math.abs(a - b) <= epsilon
export const roundTo = (value: number, digits: number): number => {
	const factor = 10 ** digits
	return Math.round(value * factor) / factor
}
export const snap = (value: number, grid: number): number => (grid === 0 ? value : Math.round(value / grid) * grid)
export const sqr = (value: number): number => value * value
export const cube = (value: number): number => value * value * value
export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x))
export const gaussian = (x: number, mean = 0, sigma = 1): number => Math.exp(-((x - mean) ** 2) / (2 * sigma * sigma)) / (sigma * Math.sqrt(TAU))

export const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)
export const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : sum(values) / values.length)
export const minOf = (values: readonly number[]): number => Math.min(...values)
export const maxOf = (values: readonly number[]): number => Math.max(...values)
export function median(values: readonly number[]): number {
	if (values.length === 0) return 0
	const sorted = [...values].sort((a, b) => a - b)
	const middle = Math.floor(sorted.length / 2)
	return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}
export const variance = (values: readonly number[]): number => {
	const average = mean(values)
	return mean(values.map((value) => (value - average) ** 2))
}
export const stddev = (values: readonly number[]): number => Math.sqrt(variance(values))

export function factorial(n: number): number {
	let result = 1
	for (let index = 2; index <= Math.min(170, Math.floor(n)); index++) result *= index
	return result
}
export function gcd(a: number, b: number): number {
	let x = Math.abs(Math.trunc(a))
	let y = Math.abs(Math.trunc(b))
	while (y !== 0) [x, y] = [y, x % y]
	return x
}
export const lcm = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : Math.abs(Math.trunc(a) * Math.trunc(b)) / gcd(a, b))
export function isPrime(n: number): boolean {
	if (!Number.isInteger(n) || n < 2) return false
	for (let divisor = 2; divisor * divisor <= n; divisor++) if (n % divisor === 0) return false
	return true
}
export const isPowerOfTwo = (n: number): boolean => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0
export const nextPowerOfTwo = (n: number): number => (n <= 1 ? 1 : 2 ** Math.ceil(Math.log2(n)))

/**
 * Critically damped smoothing toward a target that keeps its own velocity. Feed the returned velocity back in next frame.
 */
export function smoothDamp(current: number, target: number, velocity: number, smoothTime: number, dt: number, maxSpeed = Infinity): { readonly value: number; readonly velocity: number } {
	const omega = 2 / Math.max(0.0001, smoothTime)
	const x = omega * dt
	const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
	const maxChange = maxSpeed * smoothTime
	const change = clamp(current - target, -maxChange, maxChange)
	const temp = (velocity + omega * change) * dt
	let nextVelocity = (velocity - omega * temp) * decay
	let value = current - change + (change + temp) * decay
	if (target - current > 0 === value > target) {
		value = target
		nextVelocity = dt === 0 ? 0 : (value - target) / dt
	}
	return { value, velocity: nextVelocity }
}
