import { copyFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve, staticFiles } from '@gambrel/bun'
import { createApp, html, text } from '@gambrel/core'
import { renderToString } from '@gambrel/view'
import { Shell } from '../apps/editor/src/shell.tsx'

const root = resolve(import.meta.dir, '..')
const editor = join(root, 'apps/editor')
const assets = join(root, '.cache/editor')
const port = Number(Bun.env['PORT'] ?? 3220)
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('PORT must be an integer between 0 and 65535')

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
	await mkdir(assets, { recursive: true })
	await copyFile(fileURLToPath(import.meta.resolve('@gambrel/components/styles.css')), join(assets, 'components.css'))
	await copyFile(join(editor, 'public/editor.css'), join(assets, 'editor.css'))
	return true
}

if (!(await build())) process.exit(1)

const app = createApp({ development: true })
	.use(async (context, next) => {
		if (context.url.pathname === '/assets/client.js' && !(await build())) return text('Build failed; see the terminal', { status: 500 })
		const response = await next()
		const headers = new Headers(response.headers)
		headers.set('content-security-policy', POLICY)
		headers.set('x-content-type-options', 'nosniff')
		headers.set('referrer-policy', 'no-referrer')
		return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
	})
	.use(staticFiles({ directory: assets, prefix: '/assets' }))
	.get('/', async () => html(`<!doctype html>${await renderToString(Shell())}`, { headers: { 'cache-control': 'no-store' } }))

const server = serve(app, { port, hostname: 'localhost', development: true })
console.log(`Strata editor: ${server.url.href}`)
