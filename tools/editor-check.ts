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
import { packProject, unpackProject } from '../apps/editor/src/archive.ts'
import { readZip, writeZip } from '../apps/editor/src/zip.ts'
import { bundleScripts } from './scripts.ts'
import * as lib from '../packages/scripting/src/stdlib/index.ts'
import { isSealed, seal, unseal } from '../apps/editor/src/seal.ts'

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
	if (label === 'bare' && (result.ok || result.error !== 'Scripts can import only other scripts and "strata". Use "import type" for types.')) {
		throw new Error('Unexpected bare import error')
	}
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

const zipped = writeZip([
	{ name: 'a.txt', data: new TextEncoder().encode('hello') },
	{ name: 'dir/b.bin', data: new Uint8Array([1, 2, 3]) }
])
const unzipped = readZip(zipped)
console.log('zip', unzipped.ok ? unzipped.value.map((file) => `${file.name}:${file.data.length}`).join(',') : unzipped.error.message)
const damaged = zipped.slice()
damaged[36] = (damaged[36] ?? 0) ^ 255
console.log('zip-corrupt', readZip(damaged).ok)

const sourceStorage = new MemoryStorage()
const originalResult = await Project.create(sourceStorage, 'Pack')
if (!originalResult.ok) throw originalResult.error
const original = originalResult.value
await original.assets.importAsset('a.ts', new TextEncoder().encode('export default {}'))
await original.saveScene('main', '{"x":1}')
const packed = await packProject(sourceStorage)
const restored = await unpackProject(packed.ok ? packed.value : new Uint8Array(), new MemoryStorage())
console.log('archive', packed.ok, restored.ok && restored.value.name, restored.ok && restored.value.assets.list().length, restored.ok && (await restored.value.loadScene('main')).ok)
const evil = writeZip([
	{ name: '../evil', data: new Uint8Array([1]) },
	{ name: 'project.json', data: new Uint8Array([1]) }
])
console.log('archive-evil', (await unpackProject(evil, new MemoryStorage())).ok)

console.log('math', lib.clamp(5, 0, 3), lib.remap(5, 0, 10, 100, 200), lib.wrap(370, 0, 360), lib.roundTo(3.14159, 2))
const v = new lib.Vec2(3, 4)
console.log('vec', v.len(), v.normalized().x, v.add(new lib.Vec2(1, 1)).toString(), v.dot(new lib.Vec2(1, 0)))
console.log('ease', lib.easeInOutCubic(0), lib.easeInOutCubic(1), lib.roundTo(lib.easeOutBounce(1), 6), lib.easeInOutQuad(0.5), lib.EASING_NAMES.length)
const first = new lib.Random('seed')
const second = new lib.Random('seed')
console.log('random', first.int(1, 100) === second.int(1, 100), first.next() === second.next(), Array.from({ length: 1000 }, () => first.int(3, 5)).every((value) => value >= 3 && value <= 5), new lib.Random(1).next() !== new lib.Random(2).next())
const noise = new lib.Noise(7)
const twin = new lib.Noise(7)
console.log('noise', noise.perlin2(1.3, 2.7) === twin.perlin2(1.3, 2.7), Array.from({ length: 200 }, (_, index) => noise.perlin2(index * 0.37, index * 0.11)).every((value) => value >= -1 && value <= 1), noise.simplex2(0.5, 0.5) === twin.simplex2(0.5, 0.5))
console.log('color', lib.toHex(lib.hsv(120, 1, 1)), lib.toHex(lib.fromHex('#3366cc') ?? lib.COLORS.black), lib.roundTo(lib.contrastRatio(lib.COLORS.white, lib.COLORS.black), 1))
const square = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]
console.log('geometry', lib.rectsOverlap({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 }), lib.pointInPolygon({ x: 1, y: 1 }, square), lib.polygonArea(square), lib.segmentsIntersect({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 }))
console.log('curves', lib.bezier3(0, 0, 1, 1, 0.5), lib.catmullRom(0, 1, 2, 3, 0.5))
const queue = new lib.PriorityQueue<number>()
for (const value of [5, 1, 3]) queue.push(value, value)
console.log('collections', [queue.pop(), queue.pop(), queue.pop()].join(','), lib.astar(5, 5, [0, 0], [4, 4], () => true)?.length, lib.astar(5, 5, [0, 0], [4, 4], () => true, { diagonal: true })?.length, lib.astar(3, 3, [0, 0], [2, 2], (x) => x !== 1) === undefined)

const sealed = await seal(new TextEncoder().encode('secret project'), 'correct horse')
const reopened = await unseal(sealed, 'correct horse')
console.log('seal', isSealed(sealed), reopened.ok && new TextDecoder().decode(reopened.value))
console.log('seal-wrong', (await unseal(sealed, 'wrong password')).ok)
const tampered = sealed.slice()
tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1
console.log('seal-tamper', (await unseal(tampered, 'correct horse')).ok)
console.log('seal-header', (await unseal(sealed.map((byte, index) => (index === 20 ? byte ^ 1 : byte)), 'correct horse')).ok, isSealed(zipped))
const libraryScript = "import { lerp, Vec2 } from 'strata'\nexport default class A { onUpdate(ctx: any) { ctx.setPosition(lerp(0, 10, 0.5), new Vec2(3, 4).len()) } }"
const withLibrary = await bundleScripts({ entry: 'A.ts', files: { 'A.ts': libraryScript } })
if (withLibrary.ok) {
	const loaded = await import(`data:text/javascript;base64,${Buffer.from(withLibrary.code).toString('base64')}`)
	const result = simulateScript(loaded.default, { steps: 1, held: [] })
	console.log('library', result.transform.x, result.transform.y)
} else console.log('library', withLibrary.error)
