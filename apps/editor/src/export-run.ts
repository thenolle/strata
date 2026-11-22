import { StrataError, err, ok, type Result } from '@strata/core'
import type { EditorSession } from '@strata/editor-core'
import { NATIVE_TARGETS, TARGET_OPTIONS, type ExportSettings } from './export-settings.ts'
import { buildWebGame, slugName } from './export-web.ts'
import { writeZip, type ZipEntry } from './zip.ts'

export type ExportState = 'waiting' | 'building' | 'done' | 'failed'

export interface ExportOutput {
	readonly fileName: string
	readonly bytes: Uint8Array
	readonly type: string
}

/**
 * Builds every chosen target one after another and packs the results. One target gives one file, several give a zip with a folder per system.
 * Targets that fail are listed, and the others are still delivered.
 */
export async function runExport(session: EditorSession, settings: ExportSettings, report: (id: string, state: ExportState, note: string) => void): Promise<Result<{ readonly output: ExportOutput; readonly failed: readonly string[] }>> {
	const targets = TARGET_OPTIONS.map((option) => option.id).filter((id) => settings.targets.includes(id))
	for (const id of targets) report(id, 'waiting', '')
	const web = await buildWebGame(session, settings)
	if (!web.ok) {
		for (const id of targets) report(id, 'failed', web.error.message)
		return web
	}
	const name = slugName(settings.title)
	const query = encodeURIComponent(JSON.stringify({ title: settings.title, version: settings.version, author: settings.author, description: settings.description, width: settings.width, height: settings.height, resizable: settings.resizable }))
	const parts: ZipEntry[] = []
	const done: string[] = []
	const failed: string[] = []
	let native: Uint8Array | undefined
	const webZip = writeZip(web.value)
	for (const id of targets) {
		report(id, 'building', id === 'web' ? '' : 'the first build for a system downloads its runtime')
		if (id === 'web') {
			for (const entry of web.value) parts.push({ name: `web/${entry.name}`, data: entry.data })
			done.push(id)
			report(id, 'done', '')
			continue
		}
		try {
			const reply = await fetch(`/api/export/native?target=${NATIVE_TARGETS[id] ?? ''}&settings=${query}`, { method: 'POST', body: webZip.slice() })
			if (!reply.ok) {
				const info = (await reply.json().catch(() => ({}))) as { readonly error?: string }
				throw new Error(info.error ?? 'The build failed')
			}
			const bytes = new Uint8Array(await reply.arrayBuffer())
			native = bytes
			parts.push({ name: `${id}/${name}${id === 'windows' ? '.exe' : ''}`, data: bytes, mode: id === 'windows' ? 0o644 : 0o755 })
			done.push(id)
			report(id, 'done', `${(bytes.length / 1048576).toFixed(0)} MB`)
		} catch (error: unknown) {
			failed.push(id)
			report(id, 'failed', error instanceof Error ? error.message : String(error))
		}
	}
	if (done.length === 0) return err(new StrataError('invalid-argument', 'Nothing could be built'))
	try {
		if (done.length === 1 && done[0] === 'web') return ok({ output: { fileName: `${name}-web.zip`, bytes: webZip, type: 'application/zip' }, failed })
		if (done.length === 1 && native !== undefined) return ok({ output: { fileName: `${name}${done[0] === 'windows' ? '.exe' : ''}`, bytes: native, type: 'application/octet-stream' }, failed })
		return ok({ output: { fileName: `${name}-export.zip`, bytes: writeZip(parts), type: 'application/zip' }, failed })
	} catch (error: unknown) {
		return err(new StrataError('invalid-argument', error instanceof Error ? error.message : String(error)))
	}
}
