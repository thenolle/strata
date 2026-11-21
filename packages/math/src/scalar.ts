import { StrataError } from '@strata/core'

export const PI = Math.PI
export const TAU = Math.PI * 2
export const HALF_PI = Math.PI / 2
export const EPSILON = 1e-6

export function clamp(value: number, min: number, max: number): number {
	if (min > max) throw new StrataError('invalid-argument', `clamp range is inverted: ${min} > ${max}`)
	return value < min ? min : value > max ? max : value
}

export function lerp(from: number, to: number, t: number): number {
	return from + (to - from) * t
}

export function inverseLerp(from: number, to: number, value: number): number {
	return from === to ? 0 : (value - from) / (to - from)
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
	const t = clamp(inverseLerp(edge0, edge1, value), 0, 1)
	return t * t * (3 - 2 * t)
}

export function approxEqual(a: number, b: number, epsilon = EPSILON): boolean {
	return Math.abs(a - b) <= epsilon
}

export function degToRad(degrees: number): number {
	return degrees * (PI / 180)
}

export function radToDeg(radians: number): number {
	return radians * (180 / PI)
}

/**
 * Wraps an angle into [-PI, PI).
 */
export function wrapAngle(radians: number): number {
	return radians - TAU * Math.floor((radians + PI) / TAU)
}
