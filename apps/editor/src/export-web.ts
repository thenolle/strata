import { StrataError, err, ok, type Guid, type Result } from '@strata/core'
import type { EditorSession } from '@strata/editor-core'
import { AudioSource } from '@strata/gameplay'
import type { AssetRecord } from '@strata/project'
import { Sprite, saveScene } from '@strata/scene'
import { ScriptSource } from '@strata/scripting'
import type { ExportSettings } from './export-settings.ts'
import { loadControls } from './controls-settings.ts'
import { bundleScript, collectScripts, scriptPath } from './ide/bundle-client.ts'
import type { ZipEntry } from './zip.ts'

const CREDIT = 'Made with Strata by Nolly'

export function slugName(name: string): string {
	const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
	return base === '' ? 'game' : base
}

const escapeHtml = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

function page(settings: ExportSettings, favicon: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(settings.title)}</title>
${favicon === '' ? '' : `<link rel="icon" href="${favicon}">\n`}<style>html,body{margin:0;height:100%;background:${settings.background};color:#8b93a0;font:13px system-ui,sans-serif}canvas{display:block;width:100%;height:100%;outline:none}#hud{position:fixed;left:8px;bottom:6px;pointer-events:none}</style>
</head>
<body>
<canvas id="game" tabindex="0"></canvas>
<div id="hud"><span id="status"></span> ${CREDIT}</div>
<script src="player.js"></script>
</body>
</html>
`
}

/**
 * The files of a web version of the open scene: a page, the player, the scene with its scripts, every asset it uses and the icon.
 */
export async function buildWebGame(session: EditorSession, settings: ExportSettings): Promise<Result<ZipEntry[]>> {
	const scene = saveScene(session.world, session.registry)
	if (!scene.ok) return scene
	const ids = new Set<string>()
	for (const entity of session.world.query(Sprite)) ids.add(session.world.require(entity, Sprite).asset)
	for (const entity of session.world.query(AudioSource)) ids.add(session.world.require(entity, AudioSource).asset)
	for (const entity of session.world.query(ScriptSource)) ids.add(session.world.require(entity, ScriptSource).asset)
	ids.delete('')
	const assets = session.project.assets
	const records: AssetRecord[] = []
	const scripts: { id: string; code: string }[] = []
	const files: ZipEntry[] = []
	let sources: Record<string, string> | undefined
	for (const id of ids) {
		const record = assets.get(id as Guid)
		if (record === undefined) continue
		records.push(record)
		if (record.kind === 'script') {
			sources ??= await collectScripts(assets)
			const bundled = await bundleScript(sources, scriptPath(record))
			if (!bundled.ok) return err(new StrataError('invalid-format', `${record.name}: ${bundled.error}`))
			scripts.push({ id: record.id, code: bundled.code })
			continue
		}
		const bytes = await assets.read(record.id)
		if (!bytes.ok) return bytes
		files.push({ name: `assets/${record.id}`, data: bytes.value })
	}
	let favicon = ''
	const iconRecord = settings.icon === '' ? undefined : assets.get(settings.icon as Guid)
	if (iconRecord?.kind === 'image') {
		const bytes = await assets.read(iconRecord.id)
		if (bytes.ok) {
			files.push({ name: 'icon.png', data: bytes.value })
			let binary = ''
			for (const byte of bytes.value) binary += String.fromCharCode(byte)
			favicon = `data:image/png;base64,${btoa(binary)}`
		}
	}
	const player = await fetch('/assets/webplayer.js')
	if (!player.ok) return err(new StrataError('not-found', 'The web player is missing from this editor build'))
	const encoder = new TextEncoder()
	const game = { format: 'strata.game', name: settings.title, version: settings.version, author: settings.author, credit: CREDIT, scene: scene.value, assets: records, scripts, controls: await loadControls(session) }
	return ok([
		{ name: 'index.html', data: encoder.encode(page(settings, favicon)) },
		{ name: 'player.js', data: new Uint8Array(await player.arrayBuffer()) },
		{ name: 'game.json', data: encoder.encode(JSON.stringify(game)) },
		...files
	])
}
