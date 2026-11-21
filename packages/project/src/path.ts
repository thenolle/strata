import { StrataError } from '@strata/core'

const SEGMENT = /^[^\x00-\x1f\\/:*?"<>|]+$/
const RESERVED = new Set(['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'])

function invalid(path: string): StrataError {
	return new StrataError('invalid-argument', `Invalid project path "${path}"`)
}

/**
 * Validates a project-relative path with forward slashes. Rejects traversal, empty segments, characters that are
 * illegal on Windows and reserved device names, so every project stays portable and confined to its folder.
 */
export function normalizePath(path: string): string {
	if (path.length === 0 || path.length > 1024) throw invalid(path)
	const segments = path.split('/')
	for (const segment of segments) {
		const device = segment.split('.')[0] ?? ''
		if (
			segment === '' ||
			segment === '.' ||
			segment === '..' ||
			segment.length > 255 ||
			!SEGMENT.test(segment) ||
			segment.endsWith('.') ||
			segment.endsWith(' ') ||
			RESERVED.has(device.toUpperCase())
		) {
			throw invalid(path)
		}
	}
	return segments.join('/')
}

/**
 * Like `normalizePath`, but the empty string means the project root.
 */
export function normalizePrefix(prefix: string): string {
	return prefix === '' ? '' : normalizePath(prefix)
}
