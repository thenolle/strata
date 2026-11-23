export type ControlKind = 'stick' | 'button'

export interface ControlItem {
	readonly id: string
	readonly kind: ControlKind
	/** Center, as a percentage of the screen's width and height. */
	readonly x: number
	readonly y: number
	/** Diameter in pixels. */
	readonly size: number
	/** A button presses one key. A stick presses left, right, up and down. */
	readonly keys: readonly string[]
	readonly label: string
}

export interface ControlLayout {
	readonly mode: 'auto' | 'always' | 'never'
	readonly opacity: number
	readonly items: readonly ControlItem[]
}

const ARROWS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
const KEY = /^[A-Za-z0-9]{1,24}$/
const DEAD = 0.35

const stick = (id: string, x: number, y: number, size: number): ControlItem => ({ id, kind: 'stick', x, y, size, keys: ARROWS, label: '' })
const button = (id: string, x: number, y: number, size: number, key: string, label: string): ControlItem => ({ id, kind: 'button', x, y, size, keys: [key], label })

export const CONTROL_PRESETS: Readonly<Record<string, ControlLayout>> = {
	Platformer: { mode: 'auto', opacity: 0.6, items: [stick('stick', 16, 76, 130), button('jump', 86, 76, 90, 'Space', 'Jump'), button('act', 72, 88, 68, 'KeyE', 'Act')] },
	'Top-down': { mode: 'auto', opacity: 0.6, items: [stick('stick', 16, 76, 130), button('act', 86, 76, 90, 'KeyE', 'Act'), button('alt', 72, 88, 68, 'Space', 'Alt')] },
	'Two buttons': { mode: 'auto', opacity: 0.6, items: [button('left', 10, 80, 84, 'ArrowLeft', '◀'), button('right', 26, 80, 84, 'ArrowRight', '▶'), button('jump', 88, 78, 96, 'Space', 'Jump')] },
	None: { mode: 'never', opacity: 0.6, items: [] }
}

export const DEFAULT_CONTROLS: ControlLayout = CONTROL_PRESETS['Platformer'] as ControlLayout

const clamp = (value: unknown, min: number, max: number, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback)

/** Turns anything into a valid layout: unknown controls are dropped and numbers are limited to sensible ranges. */
export function parseControls(value: unknown): ControlLayout {
	if (typeof value !== 'object' || value === null) return DEFAULT_CONTROLS
	const raw = value as Record<string, unknown>
	const items: ControlItem[] = []
	if (Array.isArray(raw['items'])) {
		for (const entry of raw['items'].slice(0, 16)) {
			if (typeof entry !== 'object' || entry === null) continue
			const item = entry as Record<string, unknown>
			const kind = item['kind']
			if (kind !== 'stick' && kind !== 'button') continue
			const keys = Array.isArray(item['keys']) ? item['keys'].filter((key): key is string => typeof key === 'string' && KEY.test(key)).slice(0, 4) : []
			if (kind === 'button' && keys.length === 0) continue
			const id = item['id']
			const label = item['label']
			items.push({
				id: typeof id === 'string' && id !== '' ? id.slice(0, 32) : `c${items.length + 1}`,
				kind,
				x: clamp(item['x'], 0, 100, 50),
				y: clamp(item['y'], 0, 100, 50),
				size: clamp(item['size'], 32, 300, kind === 'stick' ? 120 : 80),
				keys: kind === 'stick' ? (keys.length === 4 ? keys : ARROWS) : keys.slice(0, 1),
				label: typeof label === 'string' ? label.replace(/[\u0000-\u001f]/g, '').slice(0, 8) : ''
			})
		}
	}
	const mode = raw['mode']
	return { mode: mode === 'always' || mode === 'never' ? mode : 'auto', opacity: clamp(raw['opacity'], 0.1, 1, 0.6), items }
}

/**
 * Shows the controls over the page and reports key presses and releases. Returns a function that removes them.
 */
export function attachVirtualControls(canvas: HTMLCanvasElement, layout: ControlLayout, sink: (code: string, down: boolean) => void): () => void {
	const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0
	if (layout.mode === 'never' || (layout.mode === 'auto' && !touch) || layout.items.length === 0) return () => undefined
	const overlay = canvas.ownerDocument.createElement('div')
	overlay.className = 'strata-touch'
	Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '10', pointerEvents: 'none', userSelect: 'none', opacity: String(layout.opacity) })
	const releases: (() => void)[] = []
	for (const item of layout.items) {
		const element = canvas.ownerDocument.createElement('div')
		Object.assign(element.style, {
			position: 'absolute', left: `${item.x}%`, top: `${item.y}%`, width: `${item.size}px`, height: `${item.size}px`, transform: 'translate(-50%, -50%)',
			borderRadius: '50%', border: '2px solid rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.12)', color: '#fff', font: '600 14px system-ui, sans-serif',
			display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto', touchAction: 'none'
		})
		element.textContent = item.kind === 'button' ? item.label : ''
		let thumb: HTMLElement | undefined
		if (item.kind === 'stick') {
			thumb = canvas.ownerDocument.createElement('div')
			Object.assign(thumb.style, { width: `${item.size / 2}px`, height: `${item.size / 2}px`, borderRadius: '50%', background: 'rgba(255,255,255,0.45)', pointerEvents: 'none' })
			element.append(thumb)
		}
		const held = new Set<string>()
		let pointer: number | undefined
		const set = (code: string | undefined, down: boolean): void => {
			if (code === undefined) return
			if (down) {
				if (!held.has(code)) {
					held.add(code)
					sink(code, true)
				}
			} else if (held.delete(code)) sink(code, false)
		}
		const aim = (event: PointerEvent): void => {
			const rect = element.getBoundingClientRect()
			const radius = rect.width / 2
			const dx = Math.max(-1, Math.min(1, (event.clientX - rect.left - radius) / radius))
			const dy = Math.max(-1, Math.min(1, (event.clientY - rect.top - radius) / radius))
			if (thumb !== undefined) thumb.style.transform = `translate(${dx * radius * 0.5}px, ${dy * radius * 0.5}px)`
			set(item.keys[0], dx < -DEAD)
			set(item.keys[1], dx > DEAD)
			set(item.keys[2], dy < -DEAD)
			set(item.keys[3], dy > DEAD)
		}
		const release = (): void => {
			pointer = undefined
			for (const code of [...held]) set(code, false)
			if (thumb !== undefined) thumb.style.transform = ''
			element.style.background = 'rgba(255,255,255,0.12)'
		}
		element.addEventListener('pointerdown', (event) => {
			if (pointer !== undefined) return
			pointer = event.pointerId
			element.setPointerCapture(event.pointerId)
			event.preventDefault()
			element.style.background = 'rgba(255,255,255,0.28)'
			if (item.kind === 'button') set(item.keys[0], true)
			else aim(event)
		})
		element.addEventListener('pointermove', (event) => {
			if (event.pointerId === pointer && item.kind === 'stick') aim(event)
		})
		for (const name of ['pointerup', 'pointercancel'] as const) element.addEventListener(name, (event) => event.pointerId === pointer && release())
		releases.push(release)
		overlay.append(element)
	}
	canvas.ownerDocument.body.append(overlay)
	return () => {
		for (const release of releases) release()
		overlay.remove()
	}
}
