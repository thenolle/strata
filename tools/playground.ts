import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const entry = resolve(root, 'apps/playground/src/main.ts')
const port = Number(Bun.env['PORT'] ?? 3210)

const PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Strata playground</title><style>html,body{margin:0;background:#000;overflow:hidden}</style></head><body><script type="module" src="/main.js"></script></body></html>'

async function bundle(): Promise<string | undefined> {
	const result = await Bun.build({ entrypoints: [entry], target: 'browser', sourcemap: 'inline' })
	if (!result.success) {
		for (const log of result.logs) console.error(log)
		return undefined
	}
	return result.outputs[0]?.text()
}

Bun.serve({
	port,
	hostname: 'localhost',
	async fetch(request) {
		const { pathname } = new URL(request.url)
		if (pathname === '/') return new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
		if (pathname === '/main.js') {
			const script = await bundle()
			if (script === undefined) return new Response('Build failed; see the terminal', { status: 500 })
			return new Response(script, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } })
		}
		return new Response('Not found', { status: 404 })
	}
})

console.log(`Strata playground: http://localhost:${port}`)
