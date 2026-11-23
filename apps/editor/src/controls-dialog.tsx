/** @jsxImportSource @gambrel/view */
import { Button } from '@gambrel/components'
import { effect, signal } from '@gambrel/reactivity'
import type { Child, ViewEvent } from '@gambrel/view'
import type { EditorSession } from '@strata/editor-core'
import { CONTROL_PRESETS, parseControls, type ControlItem, type ControlLayout } from '@strata/input'
import { loadControls, saveControls } from './controls-settings.ts'
import { dialogs } from './dialogs.tsx'

const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
const WASD = ['KeyA', 'KeyD', 'KeyW', 'KeyS']

/**
 * Lays out the on-screen controls for phones and tablets. Drag to move; the layout is saved with the project and used in Play and every export.
 * Sizes are in pixels, so the preview is only an approximation of a real screen.
 */
export function ControlsDialog(props: { readonly session: EditorSession; readonly onClose: () => void }): Child {
	const layout = signal<ControlLayout>(parseControls(undefined))
	const selected = signal<string | undefined>(undefined)
	const capturing = signal(false)
	const message = signal('')
	void loadControls(props.session).then((loaded) => layout.set(loaded))

	const patch = (id: string, change: Partial<ControlItem>): void => layout.update((current) => ({ ...current, items: current.items.map((item) => (item.id === id ? { ...item, ...change } : item)) }))
	const find = (id: string | undefined): ControlItem | undefined => layout.peek().items.find((item) => item.id === id)
	const add = (kind: 'stick' | 'button'): void => {
		const id = `c${Date.now().toString(36)}`
		const item: ControlItem = kind === 'stick' ? { id, kind, x: 20, y: 70, size: 130, keys: ARROWS, label: '' } : { id, kind, x: 80, y: 70, size: 80, keys: ['Space'], label: 'A' }
		layout.update((current) => ({ ...current, items: [...current.items, item].slice(0, 16) }))
		selected.set(id)
	}
	const remove = (id: string): void => {
		layout.update((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }))
		selected.set(undefined)
	}
	const capture = (id: string): void => {
		capturing.set(true)
		const onKey = (event: KeyboardEvent): void => {
			event.preventDefault()
			event.stopPropagation()
			removeEventListener('keydown', onKey, true)
			capturing.set(false)
			if (event.code !== 'Escape' && /^[A-Za-z0-9]{1,24}$/.test(event.code)) patch(id, { keys: [event.code] })
		}
		addEventListener('keydown', onKey, true)
	}
	const applyPreset = async (name: string): Promise<void> => {
		const preset = CONTROL_PRESETS[name]
		if (preset === undefined) return
		if (layout.peek().items.length > 0 && !(await dialogs.confirm(`Replace the current layout with "${name}"?`, { title: 'Use preset', okLabel: 'Replace' }))) return
		layout.set(preset)
		selected.set(undefined)
	}
	const save = async (): Promise<void> => {
		await saveControls(props.session, layout.peek())
		message.set('Saved with the project')
	}

	return (
		<div class="dialog-backdrop">
			<div class="dialog dialog-wide" role="dialog" aria-label="Touch controls">
				<h2>Touch controls</h2>
				<div class="export-grid">
					<div
						class="controls-stage"
						ref={(element: Element) => {
							const stage = element as HTMLElement
							let dragging: string | undefined
							effect(() => {
								const current = layout()
								const active = selected()
								stage.replaceChildren(
									...current.items.map((item) => {
										const node = document.createElement('div')
										node.className = 'controls-item'
										node.dataset['id'] = item.id
										node.dataset['selected'] = String(item.id === active)
										node.style.cssText = `left:${item.x}%;top:${item.y}%;width:${item.size}px;height:${item.size}px;opacity:${current.opacity}`
										node.textContent = item.kind === 'button' ? item.label : '✥'
										return node
									})
								)
							})
							const move = (event: PointerEvent): void => {
								if (dragging === undefined) return
								const rect = stage.getBoundingClientRect()
								patch(dragging, { x: Math.round(Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)) * 10) / 10, y: Math.round(Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)) * 10) / 10 })
							}
							stage.addEventListener('pointerdown', (event) => {
								const id = (event.target as HTMLElement).closest<HTMLElement>('.controls-item')?.dataset['id']
								selected.set(id)
								if (id === undefined) return
								dragging = id
								stage.setPointerCapture(event.pointerId)
							})
							stage.addEventListener('pointermove', move)
							stage.addEventListener('pointerup', () => (dragging = undefined))
						}}
					></div>
					<div class="export-column">
						<label class="dialog-field">
							Preset
							<select onChange={(event: ViewEvent) => void applyPreset((event.target as HTMLSelectElement).value)}>
								<option value="">Choose…</option>
								{Object.keys(CONTROL_PRESETS).map((name) => (
									<option value={name}>{name}</option>
								))}
							</select>
						</label>
						<label class="dialog-field">
							Show the controls
							<select onChange={(event: ViewEvent) => layout.update((current) => ({ ...current, mode: (event.target as HTMLSelectElement).value as ControlLayout['mode'] }))}>
								<option value="auto" selected={() => layout().mode === 'auto'}>Only on touch screens</option>
								<option value="always" selected={() => layout().mode === 'always'}>Always</option>
								<option value="never" selected={() => layout().mode === 'never'}>Never</option>
							</select>
						</label>
						<label class="dialog-field">
							Opacity
							<input type="range" min="10" max="100" value={() => String(Math.round(layout().opacity * 100))} onInput={(event: ViewEvent) => layout.update((current) => ({ ...current, opacity: Number((event.target as HTMLInputElement).value) / 100 }))} />
						</label>
						<div class="dialog-actions">
							<Button size="sm" variant="outline" onClick={() => add('stick')}>Add stick</Button>
							<Button size="sm" variant="outline" onClick={() => add('button')}>Add button</Button>
						</div>
						{() => {
							const id = selected()
							const item = find(id)
							if (id === undefined || item === undefined) return <p class="dialog-hint">Drag a control to move it. Select one to edit it.</p>
							return (
								<div class="export-column">
									<label class="dialog-field">
										Size
										<input type="range" min="32" max="240" value={String(item.size)} onInput={(event: ViewEvent) => patch(id, { size: Number((event.target as HTMLInputElement).value) })} />
									</label>
									{item.kind === 'button' ? (
										<div class="export-column">
											<label class="dialog-field">
												Label
												<input type="text" maxlength={8} value={item.label} onInput={(event: ViewEvent) => patch(id, { label: (event.target as HTMLInputElement).value })} />
											</label>
											<Button size="sm" variant="outline" onClick={() => capture(id)}>
												{() => (capturing() ? 'Press a key…' : `Key: ${find(id)?.keys[0] ?? ''} (click to change)`)}
											</Button>
										</div>
									) : (
										<label class="dialog-field">
											Keys
											<select onChange={(event: ViewEvent) => patch(id, { keys: (event.target as HTMLSelectElement).value === 'wasd' ? WASD : ARROWS })}>
												<option value="arrows" selected={item.keys[0] !== 'KeyA'}>Arrow keys</option>
												<option value="wasd" selected={item.keys[0] === 'KeyA'}>W A S D</option>
											</select>
										</label>
									)}
									<Button size="sm" variant="destructive" onClick={() => remove(id)}>Remove control</Button>
								</div>
							)
						}}
					</div>
				</div>
				{() => (message() === '' ? null : <p class="notice">{message()}</p>)}
				<div class="dialog-actions">
					<Button variant="outline" onClick={props.onClose}>Close</Button>
					<Button onClick={() => void save()}>Save</Button>
				</div>
			</div>
		</div>
	)
}
