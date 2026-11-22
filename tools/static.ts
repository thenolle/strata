import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? '.')
Bun.serve({
	port: 8080,
	hostname: '127.0.0.1',
	async fetch(request) {
		const path = decodeURIComponent(new URL(request.url).pathname)
		const file = resolve(join(root, path === '/' ? 'index.html' : path))
		if (!file.startsWith(root)) return new Response('Forbidden', { status: 403 })
		const content = Bun.file(file)
		return (await content.exists()) ? new Response(content) : new Response('Not found', { status: 404 })
	}
})
console.log('http://127.0.0.1:8080/')
