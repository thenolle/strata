import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Ide, type DiagnosticOut } from './ide.ts'

const root = resolve(import.meta.dir, '..')
const template = await readFile(resolve(root, 'apps/editor/src/ide/script-template.txt'), 'utf8')
const ide = new Ide(root)
const call = template.split('\n').find((line) => line.includes('ctx.log('))?.trim() ?? ''

async function until(read: () => Promise<DiagnosticOut[]>, done: (items: DiagnosticOut[]) => boolean, timeoutMs = 15_000): Promise<DiagnosticOut[]> {
	const started = Date.now()
	for (; ;) {
		const items = await read()
		if (done(items) || Date.now() - started > timeoutMs) return items
		await Bun.sleep(300)
	}
}

try {
	await ide.sync('check', template)
	await Bun.sleep(2000)
	console.log('clean', (await ide.diagnostics('check')).length)
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
	console.log('hover', hover.text.includes('setPosition'))
	const signed = template.replace(call, 'ctx.log(')
	await ide.sync('check', signed)
	const signedLines = signed.split('\n')
	const signedLine = signedLines.findIndex((text) => text.trim() === 'ctx.log(')
	const help = await ide.signature('check', signedLine, (signedLines[signedLine] ?? '').length)
	console.log('signature', help?.label.includes('log') === true)
	await ide.sync('check', template)
	const defLine = hoverLines.findIndex((text) => text.includes('ctx.setPosition'))
	const definition = await ide.definition('check', defLine, (hoverLines[defLine] ?? '').indexOf('setPosition') + 2)
	console.log('definition', definition?.external?.file, definition?.external?.text.includes('setPosition'))
	await ide.sync('check', 'const   x   =   1\n')
	console.log('format', (await ide.format('check')).length > 0)
} finally {
	ide.dispose()
}
