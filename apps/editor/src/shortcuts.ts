const NAMES: Readonly<Record<string, string>> = { mod: 'Ctrl', ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', contextmenu: 'Menu key', escape: 'Esc' }

/** Turns "mod+shift+z" into "Ctrl+Shift+Z" for display. */
export function prettyKeys(keys: string): string {
	return keys
		.split('+')
		.map((part) => NAMES[part] ?? (/^f\d{1,2}$/.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
		.join('+')
}
