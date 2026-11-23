import type { EditorSession } from '@strata/editor-core'
import { parseControls, type ControlLayout } from '@strata/input'

export async function loadControls(session: EditorSession): Promise<ControlLayout> {
	const loaded = await session.project.loadSettings()
	const raw = loaded.ok && typeof loaded.value === 'object' && loaded.value !== null ? (loaded.value as { readonly controls?: unknown }).controls : undefined
	return parseControls(raw)
}

export async function saveControls(session: EditorSession, layout: ControlLayout): Promise<void> {
	const loaded = await session.project.loadSettings()
	const existing = loaded.ok && typeof loaded.value === 'object' && loaded.value !== null ? (loaded.value as Record<string, unknown>) : {}
	await session.project.saveSettings({ ...existing, controls: layout })
}
