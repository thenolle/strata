/** @jsxImportSource @gambrel/view */
import { Button } from '@gambrel/components'
import { signal } from '@gambrel/reactivity'
import type { Child } from '@gambrel/view'
import type { EditorSession } from '@strata/editor-core'
import { download } from './download.ts'
import { PRESETS, TARGET_OPTIONS, defaultSettings, sanitizeSettings, type ExportSettings } from './export-settings.ts'
import { runExport, type ExportState } from './export-run.ts'

/**
 * Chooses what to export and the game's settings, saves them with the project, and builds everything chosen.
 */
export function ExportDialog(props: { readonly session: EditorSession; readonly onClose: () => void }): Child {
	const project = props.session.project
	const settings = signal<ExportSettings>(defaultSettings(project.name))
	const status = signal<readonly { readonly id: string; readonly state: ExportState; readonly note: string }[]>([])
	const busy = signal(false)
	const message = signal('')

	void project.loadSettings().then((loaded) => {
		const saved = loaded.ok && typeof loaded.value === 'object' && loaded.value !== null ? (loaded.value as { readonly export?: unknown }).export : undefined
		settings.set(sanitizeSettings(saved, project.name))
	})

	const change = (patch: Partial<ExportSettings>): void => settings.update((current) => ({ ...current, ...patch }))
	const save = async (): Promise<void> => {
		const loaded = await project.loadSettings()
		const existing = loaded.ok && typeof loaded.value === 'object' && loaded.value !== null ? (loaded.value as Record<string, unknown>) : {}
		await project.saveSettings({ ...existing, export: settings.peek() })
	}
	const report = (id: string, state: ExportState, note: string): void =>
		status.update((rows) => (rows.some((row) => row.id === id) ? rows.map((row) => (row.id === id ? { id, state, note } : row)) : [...rows, { id, state, note }]))

	const run = async (): Promise<void> => {
		busy.set(true)
		message.set('')
		status.set([])
		await save()
		const result = await runExport(props.session, settings.peek(), report)
		busy.set(false)
		if (!result.ok) {
			message.set(result.error.message)
			return
		}
		download(result.value.output.fileName, result.value.output.bytes, result.value.output.type)
		message.set(result.value.failed.length === 0 ? `Exported ${result.value.output.fileName}` : `Exported ${result.value.output.fileName}. Failed: ${result.value.failed.join(', ')}`)
	}

	const text = (label: string, key: 'title' | 'version' | 'author' | 'description'): Child => (
		<label class="dialog-field">
			{label}
			<input type="text" value={() => settings()[key]} onInput={(event) => change({ [key]: (event.target as HTMLInputElement).value })} />
		</label>
	)
	const number = (label: string, key: 'width' | 'height'): Child => (
		<label class="dialog-field">
			{label}
			<input type="number" min="240" max="7680" value={() => String(settings()[key])} onInput={(event) => change({ [key]: Number((event.target as HTMLInputElement).value) || 0 })} />
		</label>
	)

	return (
		<div class="dialog-backdrop">
			<div class="dialog dialog-wide" role="dialog" aria-label="Export game">
				<h2>Export game</h2>
				<div class="export-grid">
					<div class="export-column">
						<label class="dialog-field">
							Preset
							<select
								 onChange={(event) => {
									const preset = PRESETS.find((candidate) => candidate.label === (event.target as HTMLSelectElement).value)
									if (preset !== undefined) change({ targets: preset.targets })
								}}
							>
								<option value="">Custom…</option>
								{PRESETS.map((preset) => (
									<option value={preset.label}>{preset.label}</option>
								))}
							</select>
						</label>
						<div class="export-targets">
							{TARGET_OPTIONS.map((option) => (
								<label class="export-target">
									<input
										type="checkbox"
										checked={() => settings().targets.includes(option.id)}
										onChange={(event) => {
											const on = (event.target as HTMLInputElement).checked
											change({ targets: on ? [...new Set([...settings.peek().targets, option.id])] : settings.peek().targets.filter((id) => id !== option.id) })
										}}
									/>
									{option.label}
									<span class="export-state">
										{() => {
											const row = status().find((candidate) => candidate.id === option.id)
											return row === undefined ? '' : `${row.state}${row.note === '' ? '' : ` · ${row.note}`}`
										}}
									</span>
								</label>
							))}
						</div>
						<p class="dialog-hint">Native builds open the game in a native window with everything inside. Windows needs the Edge WebView2 runtime, Linux needs GTK 4 and WebKitGTK 6.</p>
					</div>
					<div class="export-column">
						{text('Title', 'title')}
						{text('Version', 'version')}
						{text('Author', 'author')}
						{text('Description', 'description')}
						<label class="dialog-field">
							Icon (PNG, used for the web page and the Windows executable)
							<select value={() => settings().icon} onChange={(event) => change({ icon: (event.target as HTMLSelectElement).value })}>
								<option value="">None</option>
								{project.assets.list().filter((asset) => asset.kind === 'image').map((asset) => (
									<option value={asset.id} selected={() => settings().icon === asset.id}>
										{asset.name}
									</option>
								))}
							</select>
						</label>
						<div class="export-size">
							{number('Window width', 'width')}
							{number('Window height', 'height')}
						</div>
						<label class="export-target">
							<input type="checkbox" checked={() => settings().resizable} onChange={(event) => change({ resizable: (event.target as HTMLInputElement).checked })} />
							Window can be resized
						</label>
						<label class="dialog-field">
							Background color
							<input type="color" value={() => settings().background} onInput={(event) => change({ background: (event.target as HTMLInputElement).value })} />
						</label>
					</div>
				</div>
				{() => (message() === '' ? null : <p class="notice">{message()}</p>)}
				<div class="dialog-actions">
					<Button variant="ghost" onClick={() => void save().then(() => message.set('Settings saved with the project'))}>
						Save settings
					</Button>
					<Button variant="outline" disabled={busy} onClick={props.onClose}>
						Close
					</Button>
					<Button disabled={busy} onClick={() => void run()}>
						Export
					</Button>
				</div>
			</div>
		</div>
	)
}
