import { copyFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve, staticFiles } from '@gambrel/bun'
import { createApp, html, text } from '@gambrel/core'
import { renderToString } from '@gambrel/view'
import { Shell } from '../apps/editor/src/shell.tsx'
import { bundleScripts, checkScript, compileScript } from './scripts.ts'
import { buildNative } from './native-export.ts'
import { Ide } from './ide.ts'

const root = resolve(import.meta.dir, '..')
const ide = new Ide(root)
const editor = join(root, 'apps/editor')
const assets = join(root, '.cache/editor')
const port = Number(Bun.env['PORT'] ?? 3220)
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('PORT must be an integer between 0 and 65535')
const policyEnabled = Bun.env['STRATA_CSP'] !== 'off'

function reply(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

const POLICY = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"connect-src 'self'",
	"object-src 'none'",
	"base-uri 'none'",
	"frame-ancestors 'none'"
].join('; ')

const FRAME_POLICY = [
	"default-src 'none'",
	"script-src 'self' blob:",
	"style-src 'unsafe-inline'",
	'img-src blob: data:',
	'media-src blob:',
	"connect-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
	"frame-ancestors 'self'"
].join('; ')
const FRAME_HTML = '<!doctype html><meta charset="utf-8"><title>Strata play</title><style>html,body{margin:0;height:100%;background:#0f1114}canvas{display:block;width:100%;height:100%;outline:none}</style><canvas id="game" tabindex="0"></canvas><script src="/assets/player.js"></script>'
const RUNNER_HTML = '<!doctype html><meta charset="utf-8"><title>Strata runner</title><script src="/assets/runner.js"></script>'

async function build(): Promise<boolean> {
	const result = await Bun.build({
		entrypoints: [join(editor, 'src/client.tsx')],
		target: 'browser',
		format: 'esm',
		outdir: assets,
		naming: { entry: 'client.js' },
		sourcemap: 'external',
		minify: false,
		define: { 'process.env.NODE_ENV': '"development"' }
	})
	if (!result.success) {
		for (const log of result.logs) console.error(log)
		return false
	}
	for (const name of ['player', 'runner', 'runner-worker', 'webplayer']) {
		const built = await Bun.build({
			entrypoints: [join(editor, `src/${name}.ts`)],
			target: 'browser',
			format: 'iife',
			outdir: assets,
			naming: { entry: `${name}.js` },
			sourcemap: 'external',
			minify: false,
			define: { 'process.env.NODE_ENV': '"development"' }
		})
		if (!built.success) {
			for (const log of built.logs) console.error(log)
			return false
		}
	}
	await mkdir(assets, { recursive: true })
	await copyFile(fileURLToPath(import.meta.resolve('@gambrel/components/styles.css')), join(assets, 'components.css'))
	await copyFile(join(editor, 'public/editor.css'), join(assets, 'editor.css'))
	return true
}

if (!(await build())) process.exit(1)

const app = createApp({ development: true })
	.use(async (ctx, next) => {
		if (ctx.url.pathname === '/assets/client.js' && !(await build())) return text('Build failed; see the terminal', { status: 500 })
		const response = await next()
		const headers = new Headers(response.headers)
		if (policyEnabled && !headers.has('content-security-policy')) headers.set('content-security-policy', POLICY)
		headers.set('x-content-type-options', 'nosniff')
		headers.set('referrer-policy', 'no-referrer')
		return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
	})
	.use(staticFiles({ directory: assets, prefix: '/assets' }))
	.post('/api/compile', async (ctx) => {
		if (ctx.request.headers.get('origin') !== ctx.url.origin) return reply({ ok: false, error: 'Cross-origin requests are refused' }, 403)
		const result = compileScript(await ctx.request.text())
		return reply(result, result.ok ? 200 : 400)
	})
	.post('/api/bundle', async (ctx) => {
		if (ctx.request.headers.get('origin') !== ctx.url.origin) return reply({ ok: false, error: 'Cross-origin requests are refused' }, 403)
		let body: unknown
		try {
			body = JSON.parse(await ctx.request.text())
		} catch {
			return reply({ ok: false, error: 'Invalid JSON' }, 400)
		}
		const result = await bundleScripts(body)
		return reply(result, result.ok ? 200 : 400)
	})
	.post('/api/export/native', async (ctx) => {
		if (ctx.request.headers.get('origin') !== ctx.url.origin) return reply({ ok: false, error: 'Cross-origin requests are refused' }, 403)
		const result = await buildNative(new Uint8Array(await ctx.request.arrayBuffer()), ctx.url.searchParams.get('target') ?? '')
		if (!result.ok) return reply(result, 400)
		return new Response(result.bytes as unknown as BodyInit, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${result.fileName}"`, 'cache-control': 'no-store' } })
	})
	.post('/api/check', async (ctx) => {
		if (ctx.request.headers.get('origin') !== ctx.url.origin) return reply({ ok: false, output: 'Cross-origin requests are refused' }, 403)
		return reply(await checkScript(await ctx.request.text()))
	})
	.post('/api/ide/:action', async (ctx) => {
		if (ctx.request.headers.get('origin') !== ctx.url.origin) return reply({ ok: false, error: 'Cross-origin requests are refused' }, 403)
		let body: unknown
		try {
			body = JSON.parse(await ctx.request.text())
		} catch {
			return reply({ ok: false, error: 'Invalid JSON' }, 400)
		}
		return reply(await ide.handle(ctx.params.action, body))
	})
	.get('/play/frame.html', () => html(FRAME_HTML, { headers: { 'cache-control': 'no-store', 'content-security-policy': FRAME_POLICY } }))
	.get('/play/runner.html', () => html(RUNNER_HTML, { headers: { 'cache-control': 'no-store', 'content-security-policy': FRAME_POLICY } }))
	.get('/', async () => html(`<!doctype html>${await renderToString(Shell())}`, { headers: { 'cache-control': 'no-store' } }))

const server = serve(app, { port, hostname: 'localhost', development: true })
console.log(`Strata editor: ${server.url.href}${policyEnabled ? '' : ' (content security policy off)'}`)
