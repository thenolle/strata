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
	await ide.syncProject([{ path: 'lib/math.ts', text: 'export const double = (value: number): number => value * 2\n' }])
	await ide.sync('imp', "import { double } from './lib/math'\nconst x: string = double(1)\nexport default x\n", 'Mover.ts')
	const imported = await ide.diagnostics('imp')
	console.log('import', imported.some((item) => item.message.includes('not assignable')), !imported.some((item) => item.message.includes('Cannot find module')))
	await ide.close('imp')
	await ide.syncProject([
		{ path: 'lib/math.ts', text: 'export const double = (value: number): number => value * 2\n' },
		{ path: 'Other.ts', text: "import { double } from './lib/math'\nexport const four = double(2)\n" }
	])
	await ide.sync('lib', 'export const double = (value: number): number => value * 2\n', 'lib/math.ts')
	const places = await ide.references('lib', 0, 14)
	console.log('references', places.length >= 2, places.some((place) => place.path === 'Other.ts'))
	console.log('symbols', (await ide.symbols('lib')).map((symbol) => symbol.name).join(','))
	const renamed = await ide.rename('lib', 0, 14, 'twice')
	console.log('rename', renamed.own.length, renamed.others.map((file) => file.path).join(','))
	await ide.sync('act', "import { dubble } from './lib/math'\nexport default dubble\n", 'Act.ts')
	const problems = await ide.diagnostics('act')
	const fixes = await ide.actions('act', { line: 0, character: 10, endLine: 0, endCharacter: 10 }, problems.filter((item) => item.line === 0))
	console.log('actions', fixes.length > 0)
	await ide.close('lib')
	await ide.close('act')
} finally {
	ide.dispose()
}
