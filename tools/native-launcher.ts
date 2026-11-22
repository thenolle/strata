export interface Entry {
	readonly file: string
	readonly type: string
}

/**
 * Serves the embedded game on a local port and opens it. With --check it fetches its own page, prints the result and exits.
 */
export async function run(files: ReadonlyMap<string, Entry>): Promise<void> {
	const server = Bun.serve({
		port: 0,
		hostname: '127.0.0.1',
		fetch(request) {
			const path = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html'
			const entry = files.get(path)
			if (entry === undefined) return new Response('Not found', { status: 404 })
			return new Response(Bun.file(entry.file), { headers: { 'content-type': entry.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
		}
	})
	const url = `http://127.0.0.1:${server.port}/`
	if (process.argv.includes('--check')) {
		const reply = await fetch(url)
		console.log('check', reply.status, (await reply.text()).length > 0 ? 'ok' : 'empty')
		await server.stop(true)
		return
	}
	console.log(`Playing at ${url}. Close this window to stop.`)
	const command = process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : process.platform === 'darwin' ? ['open', url] : ['xdg-open', url]
	try {
		Bun.spawn(command, { stdio: ['ignore', 'ignore', 'ignore'] })
	} catch {
		console.log('Open the address above in your browser.')
	}
}
