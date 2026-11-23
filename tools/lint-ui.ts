import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const NATIVE = /(?<![\w$.])(?:alert|confirm|prompt)\s*\(|\b(?:window|globalThis|self)\s*\.\s*(?:alert|confirm|prompt)\s*\(/
const findings: string[] = []
for await (const raw of new Bun.Glob('apps/**/*.{ts,tsx}').scan({ cwd: root })) {
	const file = raw.replaceAll('\\', '/')
	if (file.includes('node_modules/')) continue
	const lines = (await Bun.file(resolve(root, file)).text()).split('\n')
	lines.forEach((line, index) => {
		const code = line.trim()
		if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return
		if (NATIVE.test(code)) findings.push(`${file}:${index + 1}  ${code.slice(0, 100)}`)
	})
}
if (findings.length === 0) console.log('No native dialogs.')
else {
	for (const finding of findings) console.error(finding)
	console.error(`\n${findings.length} native dialog call(s). Use dialogs.alert, confirm, prompt or choose.`)
	process.exitCode = 1
}
