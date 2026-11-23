export interface ExportSettings {
	readonly title: string
	readonly version: string
	readonly author: string
	readonly description: string
	/** The id of a PNG asset, or empty. */
	readonly icon: string
	readonly width: number
	readonly height: number
	readonly resizable: boolean
	readonly background: string
	readonly targets: readonly string[]
}

export const TARGET_OPTIONS: readonly { readonly id: string; readonly label: string }[] = [
	{ id: 'web', label: 'Web (a folder for any web server)' },
	{ id: 'windows', label: 'Windows (x64)' },
	{ id: 'linux', label: 'Linux (x64)' },
	{ id: 'linux-arm', label: 'Linux (ARM64)' },
	{ id: 'mac', label: 'macOS (Apple silicon)' },
	{ id: 'mac-intel', label: 'macOS (Intel)' }
]

export const NATIVE_TARGETS: Readonly<Record<string, string>> = { windows: 'bun-windows-x64', linux: 'bun-linux-x64', 'linux-arm': 'bun-linux-arm64', mac: 'bun-darwin-arm64', 'mac-intel': 'bun-darwin-x64' }

export const PRESETS: readonly { readonly label: string; readonly targets: readonly string[] }[] = [
	{ label: 'Web only', targets: ['web'] },
	{ label: 'Windows only', targets: ['windows'] },
	{ label: 'Windows and Linux', targets: ['windows', 'linux'] },
	{ label: 'Windows, Linux and macOS', targets: ['windows', 'linux', 'linux-arm', 'mac', 'mac-intel'] },
	{ label: 'Everything', targets: ['web', 'windows', 'linux', 'linux-arm', 'mac', 'mac-intel'] }
]

const text = (value: unknown, fallback: string, max: number): string => (typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) || fallback : fallback)
const whole = (value: unknown, fallback: number, min: number, max: number): number => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback)

export function defaultSettings(name: string): ExportSettings {
	return { title: name, version: '1.0.0', author: '', description: '', icon: '', width: 1280, height: 720, resizable: true, background: '#0f1114', targets: ['web'] }
}

/**
 * Turns anything into valid settings: wrong types fall back to defaults and numbers are limited to sensible ranges.
 */
export function sanitizeSettings(value: unknown, name: string): ExportSettings {
	const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
	const base = defaultSettings(name)
	const known = raw['targets']
	const targets = Array.isArray(known) ? [...new Set(known.filter((id): id is string => typeof id === 'string' && TARGET_OPTIONS.some((option) => option.id === id)))] : []
	const version = raw['version']
	const icon = raw['icon']
	const background = raw['background']
	return {
		title: text(raw['title'], base.title, 80),
		version: typeof version === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version) ? version : base.version,
		author: text(raw['author'], '', 80),
		description: text(raw['description'], '', 200),
		icon: typeof icon === 'string' && /^[A-Za-z0-9-]{0,64}$/.test(icon) ? icon : '',
		width: whole(raw['width'], base.width, 320, 7680),
		height: whole(raw['height'], base.height, 240, 4320),
		resizable: raw['resizable'] !== false,
		background: typeof background === 'string' && /^#[0-9a-f]{6}$/i.test(background) ? background : base.background,
		targets: targets.length > 0 ? targets : base.targets
	}
}
