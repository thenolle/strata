import { clamp01, mod } from './math.ts'

/** A color with every channel from 0 to 1. */
export interface Rgba {
	readonly r: number
	readonly g: number
	readonly b: number
	readonly a: number
}

export const rgba = (r: number, g: number, b: number, a = 1): Rgba => ({ r, g, b, a })

export const COLORS = {
	white: rgba(1, 1, 1), black: rgba(0, 0, 0), red: rgba(1, 0, 0), green: rgba(0, 1, 0), blue: rgba(0, 0, 1),
	yellow: rgba(1, 1, 0), cyan: rgba(0, 1, 1), magenta: rgba(1, 0, 1), orange: rgba(1, 0.5, 0), purple: rgba(0.5, 0, 0.5),
	gray: rgba(0.5, 0.5, 0.5), transparent: rgba(0, 0, 0, 0)
} as const

/** Hue in degrees, saturation and value from 0 to 1. */
export function hsv(h: number, s: number, v: number, a = 1): Rgba {
	const hue = mod(h, 360) / 60
	const c = v * s
	const x = c * (1 - Math.abs((hue % 2) - 1))
	const parts: readonly [number, number, number] = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x]
	const m = v - c
	return { r: parts[0] + m, g: parts[1] + m, b: parts[2] + m, a }
}

export function hsl(h: number, s: number, l: number, a = 1): Rgba {
	const v = l + s * Math.min(l, 1 - l)
	return hsv(h, v === 0 ? 0 : 2 * (1 - l / v), v, a)
}

export function toHsv(color: Rgba): { readonly h: number; readonly s: number; readonly v: number } {
	const max = Math.max(color.r, color.g, color.b)
	const delta = max - Math.min(color.r, color.g, color.b)
	let h = 0
	if (delta !== 0) h = max === color.r ? ((color.g - color.b) / delta) % 6 : max === color.g ? (color.b - color.r) / delta + 2 : (color.r - color.g) / delta + 4
	return { h: mod(h * 60, 360), s: max === 0 ? 0 : delta / max, v: max }
}

/** Reads #rgb, #rgba, #rrggbb or #rrggbbaa. Returns undefined for anything else. */
export function fromHex(text: string): Rgba | undefined {
	const match = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text.trim())
	const digits = match?.[1]
	if (digits === undefined) return undefined
	const full = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits
	const channel = (index: number): number => Number.parseInt(full.slice(index * 2, index * 2 + 2), 16) / 255
	return { r: channel(0), g: channel(1), b: channel(2), a: full.length === 8 ? channel(3) : 1 }
}

export function toHex(color: Rgba, withAlpha = false): string {
	const byte = (value: number): string => Math.round(clamp01(value) * 255).toString(16).padStart(2, '0')
	return `#${byte(color.r)}${byte(color.g)}${byte(color.b)}${withAlpha ? byte(color.a) : ''}`
}

export const mixColors = (a: Rgba, b: Rgba, t: number): Rgba => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: a.a + (b.a - a.a) * t })
export const withAlpha = (color: Rgba, alpha: number): Rgba => ({ ...color, a: alpha })
export const lighten = (color: Rgba, amount: number): Rgba => mixColors(color, COLORS.white, amount)
export const darken = (color: Rgba, amount: number): Rgba => mixColors(color, COLORS.black, amount)

/** Relative luminance as defined for accessibility contrast. */
export function luminance(color: Rgba): number {
	const linear = (value: number): number => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
	return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
}

/** Contrast ratio from 1 to 21. Text needs at least 4.5. */
export function contrastRatio(a: Rgba, b: Rgba): number {
	const high = Math.max(luminance(a), luminance(b))
	const low = Math.min(luminance(a), luminance(b))
	return (high + 0.05) / (low + 0.05)
}

/** Samples a gradient given as stops sorted by position (0 to 1). */
export function gradient(stops: readonly { readonly at: number; readonly color: Rgba }[], t: number): Rgba {
	const first = stops[0]
	const last = stops[stops.length - 1]
	if (first === undefined || last === undefined) return COLORS.black
	if (t <= first.at) return first.color
	if (t >= last.at) return last.color
	for (let index = 1; index < stops.length; index++) {
		const right = stops[index]
		const left = stops[index - 1]
		if (right !== undefined && left !== undefined && t <= right.at) return mixColors(left.color, right.color, (t - left.at) / (right.at - left.at || 1))
	}
	return last.color
}
