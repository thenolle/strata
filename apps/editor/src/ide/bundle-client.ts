import type { Guid } from '@strata/core'
import type { EditorSession } from '@strata/editor-core'

type Assets = EditorSession['project']['assets']

export type Bundled = { readonly ok: true; readonly code: string } | { readonly ok: false; readonly error: string }

/** The path a script is known by to its importers: its folder and name. */
export function scriptPath(record: { readonly folder: string; readonly name: string }): string {
	return record.folder === '' ? record.name : `${record.folder}/${record.name}`
}

/**
 * Reads every script in the project. Text in `overrides`, such as unsaved editor content, wins over the stored file.
 */
export async function collectScripts(assets: Assets, overrides: ReadonlyMap<Guid, string> = new Map()): Promise<Record<string, string>> {
	const files: Record<string, string> = {}
	for (const record of assets.list()) {
		if (record.kind !== 'script') continue
		const live = overrides.get(record.id)
		if (live !== undefined) {
			files[scriptPath(record)] = live
			continue
		}
		const bytes = await assets.read(record.id, false)
		if (bytes.ok) files[scriptPath(record)] = new TextDecoder().decode(bytes.value)
	}
	return files
}

/**
 * Asks the editor server to bundle one script together with the scripts it imports.
 */
export async function bundleScript(files: Record<string, string>, entry: string): Promise<Bundled> {
	const response = await fetch('/api/bundle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entry, files }) })
	return (await response.json()) as Bundled
}
