import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Ide } from './ide.ts'

const root = resolve(import.meta.dir, '..')
const template = await readFile(resolve(root, 'apps/editor/src/ide/script-template.txt'), 'utf8')
const ide = new Ide(root)
const call = "ctx.log('Hello from', ctx.name)"

async function until<T>(read: () => T, done: (value: T) => boolean, timeoutMs = 15_000): Promise<T> {
	const started = Date.now()
	for (;;) {
		const value = read()
		if (done(value) || Date.now() - started > timeoutMs) return value
		await Bun.sleep(200)
	}
}

try {
	await ide.sync('check', template)
	await Bun.sleep(2000)
	console.log('clean', ide.diagnostics('check').length)
	await ide.sync('check', template.replace(call, 'ctx.logg'))
	const broken = await until(() => ide.diagnostics('check'), (items) => items.length > 0)
	console.log('broken', broken.some((item) => item.message.includes('logg')))
	const partial = template.replace(call, 'ctx.')
	await ide.sync('check', partial)
	const lines = partial.split('\n')
	const line = lines.findIndex((text) => text.trim() === 'ctx.')
	const labels = (await ide.completion('check', line, (lines[line] ?? '').length)).map((item) => item.label)
	console.log('completion', labels.includes('log'), labels.includes('setPosition'))
	await ide.sync('check', template)
	const hoverLines = template.split('\n')
	const hoverLine = hoverLines.findIndex((text) => text.includes('ctx.setPosition'))
	const hover = await ide.hover('check', hoverLine, (hoverLines[hoverLine] ?? '').indexOf('setPosition') + 2)
	console.log('hover', hover.includes('setPosition'))
} finally {
	ide.dispose()
}
