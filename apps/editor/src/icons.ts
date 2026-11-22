export type IconName =
	| 'chevron-right'
	| 'chevron-down'
	| 'folder'
	| 'folder-open'
	| 'file'
	| 'typescript'
	| 'image'
	| 'audio'
	| 'new-file'
	| 'new-folder'
	| 'import'
	| 'trash'
	| 'files'
	| 'book'
	| 'move'
	| 'rotate'
	| 'scale'
	| 'rect'
	| 'close'
	| 'search'

type Part = readonly [tag: string, attributes: Readonly<Record<string, string>>, text?: string]

const FOLDER = 'M1.5 3.5h4.2l1.4 1.5h7.4v8h-13z'
const FILE = 'M3.5 1.5h5.5l3.5 3.5v9.5h-9z'

const ICONS: Readonly<Record<IconName, readonly Part[]>> = {
	'chevron-right': [['path', { d: 'M6 3.5 10.5 8 6 12.5' }]],
	'chevron-down': [['path', { d: 'M3.5 6 8 10.5 12.5 6' }]],
	folder: [['path', { d: FOLDER, fill: '#dcb67a', stroke: 'none' }]],
	'folder-open': [
		['path', { d: 'M1.5 3.5h4.2l1.4 1.5h6.4v1.8H3.8L1.5 12.5z', fill: '#dcb67a', stroke: 'none' }],
		['path', { d: 'M3.8 7h11.2l-2.3 6H1.5z', fill: '#e8c98f', stroke: 'none' }]
	],
	file: [
		['path', { d: FILE }],
		['path', { d: 'M9 1.5V5h3.5' }]
	],
	typescript: [
		['rect', { x: '1.5', y: '1.5', width: '13', height: '13', rx: '2', fill: '#3178c6', stroke: 'none' }],
		['text', { x: '8', y: '11.6', 'text-anchor': 'middle', 'font-size': '7.5', 'font-weight': '700', fill: '#ffffff', stroke: 'none', 'font-family': 'system-ui, sans-serif' }, 'TS']
	],
	image: [
		['rect', { x: '2', y: '3', width: '12', height: '10', rx: '1.5', stroke: '#c586c0' }],
		['circle', { cx: '5.6', cy: '6.4', r: '1.2', fill: '#c586c0', stroke: 'none' }],
		['path', { d: 'M2.5 12 6.5 8.5 9 10.5 11 8.5 13.5 11.5', stroke: '#c586c0' }]
	],
	audio: [
		['path', { d: 'M2.5 6h2.5L8.5 3v10L5 10H2.5z', fill: '#e2a15a', stroke: 'none' }],
		['path', { d: 'M10.5 5.5a3.5 3.5 0 0 1 0 5M12.3 3.8a6 6 0 0 1 0 8.4', stroke: '#e2a15a' }]
	],
	'new-file': [
		['path', { d: FILE }],
		['path', { d: 'M8 7v4M6 9h4' }]
	],
	'new-folder': [
		['path', { d: FOLDER }],
		['path', { d: 'M8 7v4M6 9h4' }]
	],
	import: [
		['path', { d: 'M8 2v8M5 7l3 3 3-3' }],
		['path', { d: 'M2.5 11v2.5h11V11' }]
	],
	trash: [['path', { d: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9M7 7v4M9 7v4' }]],
	files: [
		['path', { d: 'M4.5 1.5h4.5l2.5 2.5v6h-7z' }],
		['path', { d: 'M2.5 4.5v10h7' }]
	],
	book: [['path', { d: 'M2.5 3c2-1 4-1 5.5.5V13c-1.5-1.5-3.5-1.5-5.5-.5zM13.5 3c-2-1-4-1-5.5.5V13c1.5-1.5 3.5-1.5 5.5-.5z' }]],
	move: [['path', { d: 'M8 1.5v13M1.5 8h13M8 1.5 6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2' }]],
	rotate: [
		['path', { d: 'M13 8a5 5 0 1 1-1.6-3.7' }],
		['path', { d: 'M13 2.5v3h-3' }]
	],
	scale: [
		['rect', { x: '2', y: '6', width: '8', height: '8' }],
		['path', { d: 'M7 9l7-7M10 2h4v4' }]
	],
	rect: [
		['rect', { x: '3.5', y: '3.5', width: '9', height: '9' }],
		['rect', { x: '2', y: '2', width: '3', height: '3', fill: 'currentColor' }],
		['rect', { x: '11', y: '2', width: '3', height: '3', fill: 'currentColor' }],
		['rect', { x: '2', y: '11', width: '3', height: '3', fill: 'currentColor' }],
		['rect', { x: '11', y: '11', width: '3', height: '3', fill: 'currentColor' }]
	],
	close: [['path', { d: 'M3.5 3.5l9 9M12.5 3.5l-9 9' }]],
	search: [
		['circle', { cx: '7', cy: '7', r: '4.5' }],
		['path', { d: 'M10.5 10.5 14 14' }]
	],
}

const NAMESPACE = 'http://www.w3.org/2000/svg'

/**
 * Builds an inline SVG icon that takes the text color. Parts with their own fill or stroke keep it, as file type icons do.
 */
export function createIcon(name: IconName, size = 16): SVGSVGElement {
	const svg = document.createElementNS(NAMESPACE, 'svg')
	svg.setAttribute('viewBox', '0 0 16 16')
	svg.setAttribute('width', String(size))
	svg.setAttribute('height', String(size))
	svg.setAttribute('fill', 'none')
	svg.setAttribute('stroke', 'currentColor')
	svg.setAttribute('stroke-width', '1.2')
	svg.setAttribute('stroke-linecap', 'round')
	svg.setAttribute('stroke-linejoin', 'round')
	svg.setAttribute('aria-hidden', 'true')
	svg.setAttribute('class', 'icon')
	for (const [tag, attributes, text] of ICONS[name]) {
		const part = document.createElementNS(NAMESPACE, tag)
		for (const [key, value] of Object.entries(attributes)) part.setAttribute(key, value)
		if (text !== undefined) part.textContent = text
		svg.append(part)
	}
	return svg
}
