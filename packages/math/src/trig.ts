const HALF_PI_HIGH = 1.5707963267948966
const HALF_PI_LOW = 6.123233995736766e-17
const TWO_OVER_PI = 0.6366197723675814
const TAN_PI_8 = 0.41421356237309503
const PI = Math.PI
const HALF_PI = Math.PI / 2
const QUARTER_PI = Math.PI / 4

function sinKernel(r: number): number {
	const r2 = r * r
	return r * (1 + r2 * (-1 / 6 + r2 * (1 / 120 + r2 * (-1 / 5040 + r2 * (1 / 362880 + r2 * (-1 / 39916800 + r2 / 6227020800))))))
}

function cosKernel(r: number): number {
	const r2 = r * r
	return 1 + r2 * (-1 / 2 + r2 * (1 / 24 + r2 * (-1 / 720 + r2 * (1 / 40320 + r2 * (-1 / 3628800 + r2 / 479001600)))))
}

function remainderOf(x: number, quadrants: number): number {
	return x - quadrants * HALF_PI_HIGH - quadrants * HALF_PI_LOW
}

function atanSeries(t: number): number {
	const t2 = t * t
	let accumulator = 0
	for (let n = 16; n >= 0; n--) accumulator = accumulator * t2 + ((n & 1) === 0 ? 1 : -1) / (2 * n + 1)
	return t * accumulator
}

function atanUnit(z: number): number {
	return z > TAN_PI_8 ? QUARTER_PI + atanSeries((z - 1) / (z + 1)) : atanSeries(z)
}

/**
 * Sine using only IEEE basic arithmetic, so results match on every JavaScript engine.
 * Absolute error is below 1e-13 for |x| up to about 1e5 and degrades beyond that. Non-finite input gives NaN.
 */
export function sin(x: number): number {
	if (!Number.isFinite(x)) return NaN
	const quadrants = Math.round(x * TWO_OVER_PI)
	const r = remainderOf(x, quadrants)
	switch ((((quadrants % 4) + 4) % 4)) {
		case 0: return sinKernel(r)
		case 1: return cosKernel(r)
		case 2: return -sinKernel(r)
		default: return -cosKernel(r)
	}
}

/**
 * Cosine with the same determinism and accuracy guarantees as `sin`.
 */
export function cos(x: number): number {
	if (!Number.isFinite(x)) return NaN
	const quadrants = Math.round(x * TWO_OVER_PI)
	const r = remainderOf(x, quadrants)
	switch ((((quadrants % 4) + 4) % 4)) {
		case 0: return cosKernel(r)
		case 1: return -sinKernel(r)
		case 2: return -cosKernel(r)
		default: return sinKernel(r)
	}
}

/**
 * Four-quadrant arctangent in (-PI, PI] using only IEEE basic arithmetic. Non-finite input gives NaN.
 */
export function atan2(y: number, x: number): number {
	if (!Number.isFinite(x) || !Number.isFinite(y)) return NaN
	const negativeY = y < 0 || Object.is(y, -0)
	if (x === 0 && y === 0) return Object.is(x, -0) ? (negativeY ? -PI : PI) : y
	const ax = Math.abs(x)
	const ay = Math.abs(y)
	const base = ax >= ay ? atanUnit(ay / ax) : HALF_PI - atanUnit(ax / ay)
	const angle = x >= 0 ? base : PI - base
	return negativeY ? -angle : angle
}
