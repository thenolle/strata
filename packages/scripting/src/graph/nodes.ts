import { EASING_NAMES } from '../stdlib/easing.ts'
import type { FlowContext, NodeSpec, PinSpec, PinType } from './types.ts'

const registry = new Map<string, NodeSpec>()
const indent = (lines: readonly string[]): string[] => lines.map((line) => `\t${line}`)

function parsePins(text: string): PinSpec[] {
	if (text === '') return []
	return text.split(',').map((part) => {
		const [head = '', fallback] = part.trim().split('=')
		const [name = '', type = 'number'] = head.split(':')
		const kind = type as PinType
		const value = fallback === undefined ? undefined : kind === 'number' ? Number(fallback) : kind === 'boolean' ? fallback === 'true' : fallback
		return { name, type: kind, ...(value === undefined ? {} : { default: value }) }
	})
}

interface Extra {
	readonly doc?: string
	readonly impure?: boolean
	readonly needs?: 'random' | 'noise'
}

function pure(id: string, category: string, title: string, inputs: string, outputs: string, expr: string | readonly string[], extra: Extra = {}): void {
	registry.set(id, {
		id, category, title, doc: extra.doc ?? title, inputs: parsePins(inputs), outputs: parsePins(outputs), expr: typeof expr === 'string' ? [expr] : expr,
		...(extra.impure === true ? { impure: true } : {}),
		...(extra.needs === undefined ? {} : { needs: extra.needs })
	})
}

function flow(id: string, category: string, title: string, inputs: string, outputs: string, emit: (c: FlowContext) => string[], extra: { readonly event?: 'onStart' | 'onUpdate'; readonly outputExpr?: (id: string, pin: string) => string } = {}): void {
	registry.set(id, {
		id, category, title, doc: title, inputs: parsePins(inputs), outputs: parsePins(outputs),
		...(extra.event === undefined ? {} : { event: extra.event }),
		flow: { emit, ...(extra.outputExpr === undefined ? {} : { outputExpr: extra.outputExpr }) }
	})
}

// Math
for (const [id, title, expr] of [
	['add', 'Add', '{a} + {b}'], ['subtract', 'Subtract', '{a} - {b}'], ['multiply', 'Multiply', '{a} * {b}'], ['divide', 'Divide', '{a} / {b}'],
	['modulo', 'Modulo', 'S.mod({a}, {b})'], ['power', 'Power', 'Math.pow({a}, {b})'], ['min', 'Minimum', 'Math.min({a}, {b})'], ['max', 'Maximum', 'Math.max({a}, {b})'],
	['atan2', 'Angle of y and x', 'Math.atan2({a}, {b})'], ['hypot', 'Hypotenuse', 'Math.hypot({a}, {b})'], ['distance', 'Distance between numbers', 'Math.abs({a} - {b})']
] as const) pure(`math.${id}`, 'Math', title, 'a:number,b:number', 'value:number', `(${expr})`)

for (const [id, title, expr] of [
	['abs', 'Absolute value', 'Math.abs({value})'], ['sign', 'Sign', 'Math.sign({value})'], ['floor', 'Floor', 'Math.floor({value})'], ['ceil', 'Ceiling', 'Math.ceil({value})'],
	['round', 'Round', 'Math.round({value})'], ['trunc', 'Truncate', 'Math.trunc({value})'], ['sqrt', 'Square root', 'Math.sqrt({value})'], ['negate', 'Negate', '-{value}'],
	['sin', 'Sine', 'Math.sin({value})'], ['cos', 'Cosine', 'Math.cos({value})'], ['tan', 'Tangent', 'Math.tan({value})'], ['asin', 'Arcsine', 'Math.asin({value})'],
	['acos', 'Arccosine', 'Math.acos({value})'], ['atan', 'Arctangent', 'Math.atan({value})'], ['exp', 'Exponential', 'Math.exp({value})'], ['log', 'Natural log', 'Math.log({value})'],
	['log2', 'Log base 2', 'Math.log2({value})'], ['log10', 'Log base 10', 'Math.log10({value})'], ['fract', 'Fraction', 'S.fract({value})'], ['toRadians', 'Degrees to radians', 'S.toRadians({value})'],
	['toDegrees', 'Radians to degrees', 'S.toDegrees({value})'], ['clamp01', 'Clamp 0 to 1', 'S.clamp01({value})'], ['sqr', 'Square', 'S.sqr({value})'], ['cube', 'Cube', 'S.cube({value})']
] as const) pure(`math.${id}`, 'Math', title, 'value:number', 'value:number', `(${expr})`)

for (const [id, title, inputs, expr] of [
	['clamp', 'Clamp', 'value:number,min:number=0,max:number=1', 'S.clamp({value}, {min}, {max})'],
	['lerp', 'Lerp', 'a:number,b:number=1,t:number=0.5', 'S.lerp({a}, {b}, {t})'],
	['inverseLerp', 'Inverse lerp', 'a:number,b:number=1,value:number=0.5', 'S.inverseLerp({a}, {b}, {value})'],
	['smoothstep', 'Smoothstep', 'edge0:number,edge1:number=1,x:number=0.5', 'S.smoothstep({edge0}, {edge1}, {x})'],
	['wrap', 'Wrap', 'value:number,min:number=0,max:number=1', 'S.wrap({value}, {min}, {max})'],
	['pingPong', 'Ping-pong', 't:number,length:number=1', 'S.pingPong({t}, {length})'],
	['approach', 'Approach', 'current:number,target:number,maxDelta:number=1', 'S.approach({current}, {target}, {maxDelta})'],
	['damp', 'Damp', 'current:number,target:number,lambda:number=5,dt:number=0.016', 'S.damp({current}, {target}, {lambda}, {dt})'],
	['remap', 'Remap', 'value:number,fromMin:number=0,fromMax:number=1,toMin:number=0,toMax:number=100', 'S.remap({value}, {fromMin}, {fromMax}, {toMin}, {toMax})'],
	['roundTo', 'Round to digits', 'value:number,digits:number=2', 'S.roundTo({value}, {digits})'],
	['snap', 'Snap to grid', 'value:number,grid:number=16', 'S.snap({value}, {grid})'],
	['lerpAngle', 'Lerp angle', 'a:number,b:number,t:number=0.5', 'S.lerpAngle({a}, {b}, {t})']
] as const) pure(`math.${id}`, 'Math', title, inputs, 'value:number', expr)

// Values
pure('value.number', 'Values', 'Number', 'value:number=0', 'value:number', '{value}')
pure('value.pi', 'Values', 'Pi', '', 'value:number', 'S.PI')
pure('value.tau', 'Values', 'Tau', '', 'value:number', 'S.TAU')
pure('value.boolean', 'Values', 'Boolean', 'value:boolean=false', 'value:boolean', '{value}')
pure('value.string', 'Values', 'Text', 'value:string=', 'value:string', '{value}')

// Logic
for (const [id, title, expr] of [['and', 'And', '{a} && {b}'], ['or', 'Or', '{a} || {b}'], ['xor', 'Exclusive or', '{a} !== {b}']] as const) pure(`logic.${id}`, 'Logic', title, 'a:boolean,b:boolean', 'value:boolean', `(${expr})`)
pure('logic.not', 'Logic', 'Not', 'value:boolean', 'value:boolean', '(!{value})')
for (const [id, title, expr] of [['equals', 'Equals', '{a} === {b}'], ['notEquals', 'Not equals', '{a} !== {b}']] as const) pure(`logic.${id}`, 'Logic', title, 'a:any,b:any', 'value:boolean', `(${expr})`)
for (const [id, title, expr] of [['greater', 'Greater than', '{a} > {b}'], ['greaterEqual', 'Greater or equal', '{a} >= {b}'], ['less', 'Less than', '{a} < {b}'], ['lessEqual', 'Less or equal', '{a} <= {b}']] as const) pure(`logic.${id}`, 'Logic', title, 'a:number,b:number', 'value:boolean', `(${expr})`)
pure('logic.approximately', 'Logic', 'Nearly equal', 'a:number,b:number,epsilon:number=0.000001', 'value:boolean', 'S.approximately({a}, {b}, {epsilon})')
pure('logic.between', 'Logic', 'Is between', 'value:number,min:number=0,max:number=1', 'value:boolean', '({value} >= {min} && {value} <= {max})')
pure('logic.selectNumber', 'Logic', 'Choose number', 'condition:boolean,a:number,b:number', 'value:number', '({condition} ? {a} : {b})')
pure('logic.selectString', 'Logic', 'Choose text', 'condition:boolean,a:string,b:string', 'value:string', '({condition} ? {a} : {b})')

// Vector 2
pure('vec2.make', 'Vector2', 'Make vector', 'x:number,y:number', 'value:vec2', 'new S.Vec2({x}, {y})')
pure('vec2.split', 'Vector2', 'Split vector', 'v:vec2', 'x:number,y:number', ['{v}.x', '{v}.y'])
for (const [id, title, inputs, out, expr] of [
	['add', 'Add vectors', 'a:vec2,b:vec2', 'vec2', '{a}.add({b})'], ['subtract', 'Subtract vectors', 'a:vec2,b:vec2', 'vec2', '{a}.sub({b})'],
	['scale', 'Scale vector', 'v:vec2,s:number=1', 'vec2', '{v}.mul({s})'], ['dot', 'Dot product', 'a:vec2,b:vec2', 'number', '{a}.dot({b})'],
	['length', 'Vector length', 'v:vec2', 'number', '{v}.len()'], ['distance', 'Vector distance', 'a:vec2,b:vec2', 'number', '{a}.dist({b})'],
	['normalize', 'Normalize vector', 'v:vec2', 'vec2', '{v}.normalized()'], ['lerp', 'Lerp vectors', 'a:vec2,b:vec2,t:number=0.5', 'vec2', '{a}.lerp({b}, {t})'],
	['rotate', 'Rotate vector', 'v:vec2,radians:number', 'vec2', '{v}.rotate({radians})'], ['angle', 'Vector angle', 'v:vec2', 'number', '{v}.angle()'],
	['fromAngle', 'Vector from angle', 'radians:number,length:number=1', 'vec2', 'S.Vec2.fromAngle({radians}, {length})'], ['perp', 'Perpendicular', 'v:vec2', 'vec2', '{v}.perp()'],
	['reflect', 'Reflect vector', 'v:vec2,normal:vec2', 'vec2', '{v}.reflect({normal})'], ['negate', 'Negate vector', 'v:vec2', 'vec2', '{v}.negate()']
] as const) pure(`vec2.${id}`, 'Vector2', title, inputs, `value:${out}`, expr)

// Easing
for (const name of EASING_NAMES) pure(`ease.${name}`, 'Easing', `Ease ${name}`, 't:number=0.5', 'value:number', `S.ease('${name}', {t})`)

// Random and noise
for (const [id, title, inputs, out, expr] of [
	['float', 'Random number', 'min:number=0,max:number=1', 'number', 'this.#random.float({min}, {max})'], ['int', 'Random whole number', 'min:number=0,max:number=10', 'number', 'this.#random.int({min}, {max})'],
	['bool', 'Random yes or no', '', 'boolean', 'this.#random.bool()'], ['chance', 'Random chance', 'probability:number=0.5', 'boolean', 'this.#random.chance({probability})'],
	['gaussian', 'Random bell curve', 'mean:number=0,deviation:number=1', 'number', 'this.#random.gaussian({mean}, {deviation})'], ['sign', 'Random sign', '', 'number', 'this.#random.sign()'],
	['angle', 'Random angle', '', 'number', 'this.#random.angle()']
] as const) pure(`random.${id}`, 'Random', title, inputs, `value:${out}`, expr, { impure: true, needs: 'random' })
for (const [id, title, expr] of [['perlin2', 'Perlin noise', 'perlin2'], ['simplex2', 'Simplex noise', 'simplex2'], ['value2', 'Value noise', 'value2'], ['worley2', 'Cell noise', 'worley2']] as const) pure(`noise.${id}`, 'Noise', title, 'x:number,y:number', 'value:number', `this.#noise.${expr}({x}, {y})`, { needs: 'noise' })
pure('noise.fbm2', 'Noise', 'Layered noise', 'x:number,y:number,octaves:number=4', 'value:number', 'this.#noise.fbm2({x}, {y}, {octaves})', { needs: 'noise' })

// Color
pure('color.hsv', 'Color', 'Color from hue', 'h:number=0,s:number=1,v:number=1,a:number=1', 'value:color', 'S.hsv({h}, {s}, {v}, {a})')
pure('color.rgba', 'Color', 'Color from channels', 'r:number=1,g:number=1,b:number=1,a:number=1', 'value:color', 'S.rgba({r}, {g}, {b}, {a})')
pure('color.mix', 'Color', 'Mix colors', 'a:color,b:color,t:number=0.5', 'value:color', 'S.mixColors({a}, {b}, {t})')
pure('color.withAlpha', 'Color', 'Set transparency', 'color:color,alpha:number=1', 'value:color', 'S.withAlpha({color}, {alpha})')
pure('color.toHex', 'Color', 'Color to hex', 'color:color', 'value:string', 'S.toHex({color})')
pure('color.luminance', 'Color', 'Brightness', 'color:color', 'value:number', 'S.luminance({color})')

// Text
for (const [id, title, inputs, out, expr] of [
	['concat', 'Join text', 'a:string,b:string', 'string', '{a} + {b}'], ['length', 'Text length', 'value:string', 'number', '{value}.length'],
	['upper', 'Uppercase', 'value:string', 'string', '{value}.toUpperCase()'], ['lower', 'Lowercase', 'value:string', 'string', '{value}.toLowerCase()'],
	['trim', 'Trim', 'value:string', 'string', '{value}.trim()'], ['contains', 'Contains', 'text:string,search:string', 'boolean', '{text}.includes({search})'],
	['startsWith', 'Starts with', 'text:string,search:string', 'boolean', '{text}.startsWith({search})'], ['endsWith', 'Ends with', 'text:string,search:string', 'boolean', '{text}.endsWith({search})'],
	['replace', 'Replace text', 'text:string,search:string,replacement:string', 'string', '{text}.split({search}).join({replacement})'],
	['substring', 'Part of text', 'text:string,start:number=0,end:number=5', 'string', '{text}.slice({start}, {end})'], ['indexOf', 'Find in text', 'text:string,search:string', 'number', '{text}.indexOf({search})'],
	['toNumber', 'Text to number', 'value:string', 'number', 'Number({value})'], ['fromNumber', 'Number to text', 'value:number', 'string', 'String({value})'],
	['toFixed', 'Number with decimals', 'value:number,digits:number=2', 'string', '{value}.toFixed({digits})'], ['repeat', 'Repeat text', 'text:string,count:number=2', 'string', '{text}.repeat({count})'],
	['padStart', 'Pad text', 'text:string,length:number=3,fill:string=0', 'string', '{text}.padStart({length}, {fill})'], ['formatNumber', 'Format number', 'value:number,decimals:number=0', 'string', 'S.formatNumber({value}, {decimals})'],
	['formatTime', 'Format time', 'seconds:number', 'string', 'S.formatTime({seconds})'], ['capitalize', 'Capitalize', 'value:string', 'string', 'S.capitalize({value})']
] as const) pure(`text.${id}`, 'Text', title, inputs, `value:${out}`, out === 'string' || out === 'boolean' || out === 'number' ? `(${expr})` : expr)

// Input and entity
pure('input.keyDown', 'Input', 'Key is held', 'key:string=Space', 'value:boolean', 'ctx.input.isDown({key})')
pure('input.keyPressed', 'Input', 'Key was pressed', 'key:string=Space', 'value:boolean', 'ctx.input.wasPressed({key})')
pure('input.axis', 'Input', 'Key axis', 'negative:string=ArrowLeft,positive:string=ArrowRight', 'value:number', 'ctx.input.axis({negative}, {positive})')
pure('entity.x', 'Entity', 'Position x', '', 'value:number', "Number(ctx.get('transform')?.['x'] ?? 0)")
pure('entity.y', 'Entity', 'Position y', '', 'value:number', "Number(ctx.get('transform')?.['y'] ?? 0)")
pure('entity.name', 'Entity', 'Name', '', 'value:string', 'ctx.name')
pure('entity.id', 'Entity', 'This entity', '', 'value:entity', 'ctx.entity')
pure('entity.time', 'Entity', 'Time since start', '', 'value:number', 'ctx.time')
pure('entity.dt', 'Entity', 'Step length', '', 'value:number', 'ctx.dt')
pure('entity.getField', 'Entity', 'Get field', 'component:string=transform,field:string=x', 'value:any', 'ctx.get({component})?.[{field}]')
pure('entity.hasComponent', 'Entity', 'Has component', 'component:string=body', 'value:boolean', 'ctx.has({component})')
pure('entity.find', 'Entity', 'Find by name', 'name:string=Player', 'value:entity', '(ctx.find({name}) ?? -1)')
pure('entity.getOtherField', 'Entity', 'Get field of other', 'entity:entity,component:string=transform,field:string=x', 'value:any', 'ctx.getOf({entity}, {component})?.[{field}]')

// Geometry
pure('geometry.distance', 'Geometry', 'Distance between points', 'x1:number,y1:number,x2:number,y2:number', 'value:number', 'Math.hypot({x2} - {x1}, {y2} - {y1})')
pure('geometry.angleTo', 'Geometry', 'Angle to point', 'x1:number,y1:number,x2:number,y2:number', 'value:number', 'Math.atan2({y2} - {y1}, {x2} - {x1})')
pure('geometry.pointInRect', 'Geometry', 'Point in rectangle', 'px:number,py:number,x:number,y:number,w:number=1,h:number=1', 'value:boolean', 'S.pointInRect({ x: {px}, y: {py} }, { x: {x}, y: {y}, w: {w}, h: {h} })')
pure('geometry.circlesOverlap', 'Geometry', 'Circles overlap', 'x1:number,y1:number,r1:number=1,x2:number,y2:number,r2:number=1', 'value:boolean', 'S.circlesOverlap({ x: {x1}, y: {y1}, r: {r1} }, { x: {x2}, y: {y2}, r: {r2} })')
pure('geometry.rectsOverlap', 'Geometry', 'Rectangles overlap', 'ax:number,ay:number,aw:number=1,ah:number=1,bx:number,by:number,bw:number=1,bh:number=1', 'value:boolean', 'S.rectsOverlap({ x: {ax}, y: {ay}, w: {aw}, h: {ah} }, { x: {bx}, y: {by}, w: {bw}, h: {bh} })')

// Variables: the compiler reads the variable named in the node's "name" value.
pure('variable.get', 'Variables', 'Get variable', '', 'value:any', '0')

// Events and flow
flow('event.start', 'Events', 'On start', '', 'then:flow', (c) => c.block('then'), { event: 'onStart' })
flow('event.update', 'Events', 'On update', '', 'then:flow', (c) => c.block('then'), { event: 'onUpdate' })
flow('flow.branch', 'Flow', 'Branch', 'exec:flow,condition:boolean=false', 'true:flow,false:flow,then:flow', (c) => [
	`if (${c.input('condition')}) {`, ...indent(c.block('true')), '} else {', ...indent(c.block('false')), '}', ...c.block('then')
])
flow('flow.sequence', 'Flow', 'Sequence', 'exec:flow', 'a:flow,b:flow,c:flow,d:flow', (c) => [...c.block('a'), ...c.block('b'), ...c.block('c'), ...c.block('d')])
flow('flow.forLoop', 'Flow', 'For loop', 'exec:flow,first:number=0,last:number=9', 'body:flow,done:flow,index:number', (c) => {
	const index = `i_${c.id}`
	return [`for (let ${index} = ${c.input('first')}; ${index} <= ${c.input('last')}; ${index}++) {`, ...indent(c.block('body')), '}', ...c.block('done')]
}, { outputExpr: (id) => `i_${id}` })
flow('flow.whileLoop', 'Flow', 'While loop', 'exec:flow,condition:boolean=false', 'body:flow,done:flow', (c) => [
	`for (let g_${c.id} = 0; g_${c.id} < 10000 && (${c.input('condition')}); g_${c.id}++) {`, ...indent(c.block('body')), '}', ...c.block('done')
])
flow('flow.doOnce', 'Flow', 'Do once', 'exec:flow', 'body:flow,then:flow', (c) => {
	const name = `#once_${c.id}`
	c.field(name, 'false')
	return [`if (!this.${name}) {`, `\tthis.${name} = true`, ...indent(c.block('body')), '}', ...c.block('then')]
})
flow('flow.every', 'Flow', 'Every few seconds', 'exec:flow,seconds:number=1', 'body:flow,then:flow', (c) => {
	const name = `#next_${c.id}`
	c.field(name, '0')
	return [`if (ctx.time >= this.${name}) {`, `\tthis.${name} = ctx.time + ${c.input('seconds')}`, ...indent(c.block('body')), '}', ...c.block('then')]
})
flow('variable.set', 'Variables', 'Set variable', 'exec:flow,value:any', 'then:flow', (c) => [`${c.variable()} = ${c.input('value')}`, ...c.block('then')])
flow('variable.add', 'Variables', 'Add to variable', 'exec:flow,amount:number=1', 'then:flow', (c) => [`${c.variable()} += ${c.input('amount')}`, ...c.block('then')])
flow('action.log', 'Actions', 'Log', 'exec:flow,message:any=', 'then:flow', (c) => [`ctx.log(${c.input('message')})`, ...c.block('then')])
flow('action.setPosition', 'Actions', 'Set position', 'exec:flow,x:number,y:number', 'then:flow', (c) => [`ctx.setPosition(${c.input('x')}, ${c.input('y')})`, ...c.block('then')])
flow('action.setField', 'Actions', 'Set field', 'exec:flow,component:string=transform,field:string=x,value:any', 'then:flow', (c) => [
	'{', `\tconst data = ctx.get(${c.input('component')})`, `\tif (data !== undefined) data[${c.input('field')}] = ${c.input('value')} as number | string | boolean`, '}', ...c.block('then')
])

export const nodeSpec = (id: string): NodeSpec | undefined => registry.get(id)
export const listNodes = (): NodeSpec[] => [...registry.values()]
export const nodeCategories = (): string[] => [...new Set(listNodes().map((spec) => spec.category))]
