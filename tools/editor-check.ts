import { applyTextEdits, offsetAt } from '../apps/editor/src/ide/editing.ts'
import { fuzzyScore } from '../apps/editor/src/ide/fuzzy.ts'
import { expandSnippet } from '../apps/editor/src/ide/snippets.ts'
import { simulateScript } from '../packages/scripting/src/index.ts'
import { EditorSession } from '../packages/editor-core/src/index.ts'
import { MemoryStorage, Project } from '../packages/project/src/index.ts'
import { World } from '../packages/core/src/index.ts'
import { Collider } from '../packages/physics/src/index.ts'
import { isDrawable } from '../packages/runtime/src/visibility.ts'
import { Camera } from '../packages/scene/src/index.ts'
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

const projectResult = await Project.create(new MemoryStorage(), 'Demo')
if (!projectResult.ok) throw projectResult.error
const project = projectResult.value
const sessionResult = await EditorSession.open(project)
if (!sessionResult.ok) throw sessionResult.error
const session = sessionResult.value
const a = session.createEntity({ name: 'A' })
const b = session.createEntity({ name: 'B', x: 10 })
const c = session.createEntity({ name: 'C', parent: b })
session.select(a)
session.select(b, 'add')
console.log('multi', session.selected.length, session.selection === b, session.isSelected(a))
session.select(a, 'toggle')
console.log('toggle', session.selected.length, session.isSelected(a))
session.selectAll()
console.log('all', session.selected.length)
session.setWorldPositions([{ entity: a, x: 5, y: 6 }, { entity: b, x: 20, y: 30 }])
session.setWorldPositions([{ entity: a, x: 7, y: 8 }, { entity: b, x: 22, y: 32 }])
console.log('group', session.getTransform(a)?.x, session.getTransform(b)?.y)
session.undo()
console.log('undo group', session.getTransform(a)?.x, session.getTransform(b)?.x)
console.log('delete', session.deleteEntities([a, b, c]), session.rows().length)
session.undo()
console.log('restore', session.rows().length, session.selected.length)

const lens = new World()
const camera = lens.spawn()
lens.add(camera, Camera, {})
const player = lens.spawn()
lens.add(player, Camera, {})
lens.add(player, Collider, {})
console.log('camera', isDrawable(lens, camera), isDrawable(lens, player))

const project2Result = await Project.create(new MemoryStorage(), 'Scenes')
if (!project2Result.ok) throw project2Result.error
const project2 = project2Result.value
const world2Result = await EditorSession.open(project2)
if (!world2Result.ok) throw world2Result.error
const world2 = world2Result.value
const hero = world2.createEntity({ name: 'Hero', x: 5 })
world2.createEntity({ name: 'Cape', parent: hero })
console.log('scene', world2.scene, (await world2.scenes()).join(','))
const prefab = world2.prefabText(hero) ?? ''
console.log('prefab', JSON.parse(prefab).format, JSON.parse(prefab).entities.length)
await world2.save()
console.log('new', (await world2.newScene('Level 2')).ok, (await world2.newScene('Level 2')).ok)
console.log('switch', (await world2.switchScene('Level 2')).ok, world2.scene, world2.rows().length, world2.dirty)
const placed = world2.paste(prefab, { at: { x: 40, y: 50 }, label: false })
console.log('paste', world2.rows().length, placed === undefined ? '' : world2.nameOf(placed), placed === undefined ? '' : world2.getTransform(placed)?.x, placed === undefined ? '' : world2.getTransform(placed)?.y)
await world2.save()
console.log('back', (await world2.switchScene('main')).ok, world2.rows().length)
console.log('delete', (await world2.deleteScene('Level 2')).ok, (await world2.scenes()).join(','))
const asset = await project2.assets.importAsset('Hero.prefab', new TextEncoder().encode(prefab), 'Prefabs')
const bad = await project2.assets.importAsset('bad.prefab', new TextEncoder().encode('{}'))
console.log('asset', asset.ok ? asset.value.kind : 'failed', bad.ok)
