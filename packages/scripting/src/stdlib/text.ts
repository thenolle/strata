const words = (text: string): string[] => text.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g) ?? []

export const padLeft = (text: string, length: number, fill = ' '): string => text.padStart(length, fill)
export const padRight = (text: string, length: number, fill = ' '): string => text.padEnd(length, fill)
export const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)
export const titleCase = (text: string): string => words(text).map((word) => capitalize(word.toLowerCase())).join(' ')
export const camelCase = (text: string): string => words(text).map((word, index) => (index === 0 ? word.toLowerCase() : capitalize(word.toLowerCase()))).join('')
export const snakeCase = (text: string): string => words(text).map((word) => word.toLowerCase()).join('_')
export const kebabCase = (text: string): string => words(text).map((word) => word.toLowerCase()).join('-')
/** Lowercase letters and digits joined by hyphens, with accents removed. */
export const slugify = (text: string): string => kebabCase(text.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''))
export const truncate = (text: string, max: number, ellipsis = '…'): string => (text.length <= max ? text : text.slice(0, Math.max(0, max - ellipsis.length)) + ellipsis)
export const isBlank = (text: string): boolean => text.trim() === ''
export const countWords = (text: string): number => (text.trim() === '' ? 0 : text.trim().split(/\s+/).length)
export const reverseText = (text: string): string => [...text].reverse().join('')
export const pluralize = (count: number, singular: string, plural = `${singular}s`): string => `${count} ${count === 1 ? singular : plural}`

/** 1234567.891 with 2 decimals becomes "1,234,567.89". Independent of the player's language settings. */
export function formatNumber(value: number, decimals = 0): string {
	const fixed = Math.abs(value).toFixed(decimals)
	const [whole = '0', fraction] = fixed.split('.')
	const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
	return `${value < 0 && Number(fixed) !== 0 ? '-' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`
}

/** Seconds as "m:ss", or "h:mm:ss" from one hour up. */
export function formatTime(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds))
	const hours = Math.floor(total / 3600)
	const minutes = Math.floor((total % 3600) / 60)
	const rest = String(total % 60).padStart(2, '0')
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

export function ordinal(n: number): string {
	const hundred = n % 100
	if (hundred >= 11 && hundred <= 13) return `${n}th`
	return `${n}${['th', 'st', 'nd', 'rd'][n % 10 < 4 ? n % 10 : 0] ?? 'th'}`
}

/** A fast 32-bit hash of a text (FNV-1a). Not for security. */
export function hashString(text: string): number {
	let hash = 0x811c9dc5
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index)
		hash = Math.imul(hash, 0x01000193) >>> 0
	}
	return hash >>> 0
}

/** Breaks a text into lines of at most width characters at spaces. */
export function wrapText(text: string, width: number): string[] {
	const lines: string[] = []
	let line = ''
	for (const word of text.split(/\s+/).filter((part) => part !== '')) {
		if (line !== '' && line.length + 1 + word.length > width) {
			lines.push(line)
			line = word
		} else line = line === '' ? word : `${line} ${word}`
	}
	if (line !== '') lines.push(line)
	return lines
}
