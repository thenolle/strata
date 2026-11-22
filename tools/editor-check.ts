import { applyTextEdits, offsetAt } from '../apps/editor/src/ide/editing.ts'
import { fuzzyScore } from '../apps/editor/src/ide/fuzzy.ts'
import { expandSnippet } from '../apps/editor/src/ide/snippets.ts'
import { simulateScript } from '../packages/scripting/src/index.ts'
import { bundleScripts } from './scripts.ts'

console.log('fuzzy', fuzzyScore('sp', 'setPosition'), (fuzzyScore('sp', 'spawn') ?? 0) > (fuzzyScore('sp', 'setPosition') ?? 0), fuzzyScore('xyz', 'setPosition'))
const expanded = expandSnippet('for (const ${1:item} of ${2:items}) {\n\t$0\n}', '\t')
console.log('snippet', JSON.stringify(expanded.text), expanded.stops.map((stop) => expanded.text.slice(stop.start, stop.end)).join('|'), expanded.stops[2]?.start === expanded.text.indexOf('\n\t}'))
console.log('offset', offsetAt('ab\ncd', 1, 1), offsetAt('ab', 5, 0), applyTextEdits('hello world', [{ line: 0, character: 0, endLine: 0, endCharacter: 5, newText: 'HELLO' }]))

const files = {
	'lib/math.ts': 'export const double = (value: number): number => value * 2',
	'Mover.ts': "import { double } from './lib/math'\nimport type { Anything } from 'strata'\nexport default class Mover { onUpdate(ctx: any) { ctx.setPosition(double(21), 0) } }"
}
const built = await bundleScripts({ entry: 'Mover.ts', files })
if (built.ok) {
	const loaded = await import(`data:text/javascript;base64,${Buffer.from(built.code).toString('base64')}`)
	console.log('bundle', true, simulateScript(loaded.default, { steps: 1, held: [] }).transform.x)
} else {
	console.log('bundle', false, built.error)
}
const cases: [string, Record<string, string>][] = [
	['bare', { 'A.ts': "import fs from 'node:fs'\nexport default class A { onStart() { fs.readFileSync('x') } }" }],
	['missing', { 'A.ts': "import './nope'\nexport default class A {}" }],
	['escape', { 'A.ts': "import '../../x'\nexport default class A {}" }]
]
for (const [label, source] of cases) {
	const result = await bundleScripts({ entry: 'A.ts', files: source })
	console.log(label, result.ok, result.ok ? '' : result.error)
}
