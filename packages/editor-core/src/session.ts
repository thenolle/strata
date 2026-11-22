import { Emitter, Identity, Logger, StrataError, World, assignIdentity, createGuid, nullSink, ok, restoreWorld, snapshotEntities, type ComponentData, type ComponentRegistry, type Disposable, type Entity, type FieldSchema, type Guid, type Result } from '@strata/core'
import { Vec3, degToRad, radToDeg, trig, wrapAngle } from '@strata/math'
import type { Project } from '@strata/project'
import { Name, Parent, Transform, TransformSystem, loadScene, saveScene, Sprite, type TransformData } from '@strata/scene'
import { createGameRegistry } from '@strata/gameplay'
import { History, type UndoableCommand } from './history.ts'

export const MAIN_SCENE = 'main'
const MAX_NAME_LENGTH = 128
const DUPLICATE_OFFSET = 16

export type RegisteredComponent = ReturnType<ComponentRegistry['definitions']> extends Iterable<infer D> ? D : never
export type ChangeKind = 'structure' | 'selection' | 'name' | 'transform' | 'sprite' | 'component' | 'assets' | 'saved'

export interface EntityRow {
	readonly entity: Entity
	readonly id: Guid
	readonly name: string
	readonly depth: number
}

export interface CreateEntityOptions {
	readonly name?: string
	readonly parent?: Entity
	readonly x?: number
	readonly y?: number
	readonly select?: boolean
	readonly asset?: string
	readonly components?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

interface SpawnData {
	readonly guid: Guid
	readonly name: string
	readonly x: number
	readonly y: number
	readonly parent: Guid | undefined
	readonly asset: string
	readonly components: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

interface ValueCommand<V> extends UndoableCommand {
	readonly to: V
}

/**
 * The state of one open project in an editor: its world, transforms, selection, history and unsaved-change tracking.
 * It has no UI. Every edit is an undoable command that refers to entities by stable id, and every mutation announces its kind.
 */
export class EditorSession implements Disposable {
	readonly project: Project
	readonly world = new World()
	readonly registry = createGameRegistry()
	readonly transforms: TransformSystem
	readonly changed = new Emitter<ChangeKind>()
	readonly #logger: Logger
	readonly #scratch = new Vec3()
	readonly #history = new History()
	readonly #guids = new Map<Guid, Entity>()
	#selection: Entity | undefined
	#rows: readonly EntityRow[] | undefined

	private constructor(project: Project, logger: Logger) {
		this.project = project
		this.#logger = logger
		this.transforms = new TransformSystem(this.world, logger.child('transforms'))
	}

	/**
	 * Opens a session and loads the project's main scene when it exists.
	 */
	static async open(project: Project, logger: Logger = new Logger(nullSink, 'editor')): Promise<Result<EditorSession>> {
		const session = new EditorSession(project, logger)
		const text = await project.loadScene(MAIN_SCENE)
		if (text.ok) {
			const loaded = loadScene(session.world, session.registry, text.value)
			if (!loaded.ok) {
				session.dispose()
				return loaded
			}
			for (const [guid, entity] of loaded.value) session.#guids.set(guid, entity)
			session.transforms.update()
		} else if (text.error.code !== 'not-found') {
			session.dispose()
			return text
		}
		return ok(session)
	}

	get selection(): Entity | undefined {
		return this.#selection
	}

	get dirty(): boolean {
		return this.#history.dirty
	}

	get canUndo(): boolean {
		return this.#history.canUndo
	}

	get canRedo(): boolean {
		return this.#history.canRedo
	}

	get undoLabel(): string | undefined {
		return this.#history.undoLabel
	}

	get redoLabel(): string | undefined {
		return this.#history.redoLabel
	}

	update(): void {
		this.transforms.update()
	}

	select(entity: Entity | undefined): void {
		this.#history.seal()
		const next = entity !== undefined && this.#isPersistent(entity) ? entity : undefined
		if (next === this.#selection) return
		this.#selection = next
		this.#announce('selection')
	}

	createEntity(options: CreateEntityOptions = {}): Entity {
		const data: SpawnData = {
			guid: createGuid(),
			name: options.name ?? `Entity ${this.world.query(Identity).length + 1}`,
			x: options.x ?? 0,
			y: options.y ?? 0,
			parent: options.parent === undefined ? undefined : this.#guidOf(options.parent),
			asset: options.asset ?? '',
			components: options.components ?? {},
		}
		const select = options.select !== false
		this.#perform({
			kind: 'structure',
			label: 'Add entity',
			execute: () => {
				this.#spawn(data)
				if (select) this.#selection = this.#guids.get(data.guid)
			},
			undo: () => {
				const entity = this.#resolve(data.guid)
				if (entity !== undefined) this.#remove(entity)
			}
		})
		return this.#guids.get(data.guid) as Entity
	}

	/**
	 * Removes an entity and all of its descendants. Undo restores them with the same ids. Returns how many entities were removed.
	 */
	deleteEntity(entity: Entity): number {
		const rootGuid = this.#guidOf(entity)
		if (rootGuid === undefined || !this.#isPersistent(entity)) return 0
		const tree = this.#subtree(entity)
		const captured = snapshotEntities(this.world, this.registry, tree)
		if (!captured.ok) {
			this.#logger.error('Entities cannot be captured for undo', captured.error)
			return 0
		}
		const snapshot = captured.value
		this.#perform({
			kind: 'structure',
			label: 'Delete entity',
			execute: () => {
				const target = this.#resolve(rootGuid)
				if (target !== undefined) this.#remove(target)
			},
			undo: () => {
				const restored = restoreWorld(this.world, this.registry, snapshot)
				if (!restored.ok) throw restored.error
				for (const [guid, restoredEntity] of restored.value) this.#guids.set(guid, restoredEntity)
				this.#selection = this.#guids.get(rootGuid)
			}
		})
		return tree.length
	}

	deleteSelected(): number {
		return this.#selection === undefined ? 0 : this.deleteEntity(this.#selection)
	}

	/**
 * Copies an entity with its descendants, offset slightly, and selects the copy. Returns the copy's root.
 */
	duplicate(entity: Entity): Entity | undefined {
		const rootGuid = this.#guidOf(entity)
		if (rootGuid === undefined || !this.#isPersistent(entity)) return undefined
		const captured = snapshotEntities(this.world, this.registry, this.#subtree(entity))
		if (!captured.ok) {
			this.#logger.error('Entities cannot be duplicated', captured.error)
			return undefined
		}
		const fresh = new Map<string, Guid>(captured.value.entities.map((item): [string, Guid] => [item.id, createGuid()]))
		const copyRoot = fresh.get(rootGuid) as Guid
		const snapshot = {
			entities: captured.value.entities.map((item) => {
				const components: Record<string, Record<string, unknown>> = {}
				for (const [name, data] of Object.entries(item.components)) {
					const copy: Record<string, unknown> = { ...data }
					for (const [field, kind] of Object.entries(this.registry.get(name)?.schema ?? {})) {
						const value = copy[field]
						if (kind === 'entity' && typeof value === 'string') copy[field] = fresh.get(value) ?? value
					}
					components[name] = copy
				}
				if (item.id === rootGuid) {
					const position = components['transform']
					const label = components['name']
					if (position !== undefined) {
						position['x'] = Number(position['x']) + DUPLICATE_OFFSET
						position['y'] = Number(position['y']) + DUPLICATE_OFFSET
					}
					if (label !== undefined) label['value'] = `${String(label['value'])} copy`.slice(0, MAX_NAME_LENGTH)
				}
				return { id: fresh.get(item.id) as Guid, components }
			})
		}
		this.#perform({
			kind: 'structure',
			label: 'Duplicate entity',
			execute: () => {
				const restored = restoreWorld(this.world, this.registry, snapshot)
				if (!restored.ok) throw restored.error
				for (const [guid, restoredEntity] of restored.value) this.#guids.set(guid, restoredEntity)
				this.#selection = this.#guids.get(copyRoot)
			},
			undo: () => {
				const target = this.#resolve(copyRoot)
				if (target !== undefined) this.#remove(target)
			}
		})
		return this.#guids.get(copyRoot)
	}

	/**
 * Serializes an entity with its descendants as text that `paste` can insert again, in this or another scene.
 */
	copyEntity(entity: Entity): string | undefined {
		const root = this.#guidOf(entity)
		if (root === undefined || !this.#isPersistent(entity)) return undefined
		const captured = snapshotEntities(this.world, this.registry, this.#subtree(entity))
		return captured.ok ? JSON.stringify({ root, entities: captured.value.entities }) : undefined
	}

	/**
	 * Inserts entities produced by `copyEntity` under new ids, offset slightly, and selects the copy. Returns its root.
	 */
	paste(text: string): Entity | undefined {
		let parsed: unknown
		try {
			parsed = JSON.parse(text)
		} catch {
			return undefined
		}
		const data = parsed as { readonly root?: unknown; readonly entities?: unknown } | null
		if (typeof data !== 'object' || data === null || typeof data.root !== 'string' || !Array.isArray(data.entities)) return undefined
		const rootGuid = data.root
		const items = (data.entities as unknown[]).filter(
			(item): item is { id: string; components: Record<string, Record<string, unknown>> } =>
				typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string' && typeof (item as { components?: unknown }).components === 'object' && (item as { components?: unknown }).components !== null
		)
		if (!items.some((item) => item.id === rootGuid)) return undefined
		const fresh = new Map<string, Guid>(items.map((item): [string, Guid] => [item.id, createGuid()]))
		const copyRoot = fresh.get(rootGuid) as Guid
		const alongsideOriginal = this.#resolve(rootGuid as Guid) !== undefined
		const snapshot = {
			entities: items.map((item) => {
				const components: Record<string, Record<string, unknown>> = {}
				for (const [name, fields] of Object.entries(item.components)) {
					const copy: Record<string, unknown> = { ...fields }
					for (const [field, kind] of Object.entries(this.registry.get(name)?.schema ?? {})) {
						const value = copy[field]
						if (kind === 'entity' && typeof value === 'string') copy[field] = fresh.get(value) ?? value
					}
					const outsideParent = typeof copy['parent'] === 'string' ? copy['parent'] : undefined
					if (name === 'parent' && item.id === rootGuid && outsideParent !== undefined && !fresh.has(outsideParent) && this.#resolve(outsideParent as Guid) === undefined) continue
					components[name] = copy
				}
				if (item.id === rootGuid) {
					const position = components['transform']
					const label = components['name']
					if (position !== undefined) {
						position['x'] = Number(position['x']) + DUPLICATE_OFFSET
						position['y'] = Number(position['y']) + DUPLICATE_OFFSET
					}
					if (label !== undefined && alongsideOriginal) label['value'] = `${String(label['value'])} copy`.slice(0, MAX_NAME_LENGTH)
				}
				return { id: fresh.get(item.id) as Guid, components }
			})
		}
		this.#perform({
			kind: 'structure',
			label: 'Paste entity',
			execute: () => {
				const restored = restoreWorld(this.world, this.registry, snapshot)
				if (!restored.ok) throw restored.error
				for (const [guid, restoredEntity] of restored.value) this.#guids.set(guid, restoredEntity)
				this.#selection = this.#guids.get(copyRoot)
			},
			undo: () => {
				const target = this.#resolve(copyRoot)
				if (target !== undefined) this.#remove(target)
			}
		})
		return this.#guids.get(copyRoot)
	}

	nameOf(entity: Entity): string {
		return this.world.get(entity, Name)?.value ?? 'Entity'
	}

	rename(entity: Entity, name: string): void {
		if (name.length > MAX_NAME_LENGTH) throw new StrataError('invalid-argument', `Names are at most ${MAX_NAME_LENGTH} characters`)
		const guid = this.#guidOf(entity)
		const current = this.world.get(entity, Name)?.value
		if (guid === undefined || current === undefined || current === name) return
		this.#perform(
			this.#valueCommand<string>('name', `rename:${guid}`, 'Rename entity', current, name, (value) => {
				const target = this.#resolve(guid)
				const data = target === undefined ? undefined : this.world.get(target, Name)
				if (data !== undefined) data.value = value
			})
		)
	}

	getTransform(entity: Entity): Readonly<TransformData> | undefined {
		return this.world.get(entity, Transform)
	}

	setTransform(entity: Entity, patch: Readonly<Partial<TransformData>>): void {
		const guid = this.#guidOf(entity)
		const current = this.world.get(entity, Transform) as unknown as Record<string, number> | undefined
		if (guid === undefined || current === undefined) return
		const from: Record<string, number> = {}
		const to: Record<string, number> = {}
		for (const [key, value] of Object.entries(patch)) {
			const before = current[key]
			if (typeof value !== 'number' || before === undefined || before === value) continue
			from[key] = before
			to[key] = value
		}
		const keys = Object.keys(to).sort()
		if (keys.length === 0) return
		this.#perform(
			this.#valueCommand<Record<string, number>>('transform', `transform:${guid}:${keys.join(',')}`, 'Edit transform', from, to, (values) => {
				const target = this.#resolve(guid)
				if (target !== undefined) this.transforms.setLocal(target, values as Partial<TransformData>)
			})
		)
	}

	/**
	 * Rotation around the z axis in degrees, in (-180, 180].
	 */
	rotationDegrees(entity: Entity): number {
		const data = this.world.get(entity, Transform)
		return data === undefined ? 0 : radToDeg(wrapAngle(2 * trig.atan2(data.qz, data.qw)))
	}

	setRotationDegrees(entity: Entity, degrees: number): void {
		const half = degToRad(degrees) / 2
		this.setTransform(entity, { qx: 0, qy: 0, qz: trig.sin(half), qw: trig.cos(half) })
	}

	spriteOf(entity: Entity): string {
		return this.world.get(entity, Sprite)?.asset ?? ''
	}

	setSprite(entity: Entity, asset: string): void {
		const guid = this.#guidOf(entity)
		const before = this.spriteOf(entity)
		if (guid === undefined || before === asset) return
		this.#perform(
			this.#valueCommand<string>('sprite', `sprite:${guid}`, 'Set sprite', before, asset, (value) => {
				const target = this.#resolve(guid)
				if (target === undefined) return
				const data = this.world.get(target, Sprite)
				if (data === undefined) this.world.add(target, Sprite, { asset: value })
				else data.asset = value
			})
		)
	}

	/**
	 * Announces that the project's asset list changed, so pickers refresh.
	 */
	notifyAssetsChanged(): void {
		this.#announce('assets')
	}

	/**
	 * How many components in the scene refer to an asset, so deleting it can warn first.
	 */
	assetUsage(id: string): number {
		let count = 0
		for (const name of ['sprite', 'audio', 'script']) {
			const definition = this.registry.get(name)
			if (definition === undefined) continue
			for (const entity of this.world.query(definition)) {
				if ((this.world.get(entity, definition) as unknown as Record<string, unknown> | undefined)?.['asset'] === id) count++
			}
		}
		return count
	}

	componentValue(entity: Entity, definition: RegisteredComponent, field: string): unknown {
		return (this.world.get(entity, definition) as unknown as Record<string, unknown> | undefined)?.[field]
	}

	/**
	 * Adds or removes a component. Removing remembers its values, so undo restores them.
	 */
	setComponent(entity: Entity, definition: RegisteredComponent, present: boolean): void {
		const guid = this.#guidOf(entity)
		if (guid === undefined || this.world.has(entity, definition) === present) return
		const current = this.world.get(entity, definition) as unknown as Record<string, unknown> | undefined
		const saved = current === undefined ? undefined : { ...current }
		const apply = (add: boolean): void => {
			const target = this.#resolve(guid)
			if (target === undefined) return
			if (add) {
				if (!this.world.has(target, definition)) this.world.add(target, definition, saved as Partial<ComponentData<FieldSchema>> | undefined)
			} else {
				this.world.remove(target, definition)
			}
		}
		this.#perform({ kind: 'component', label: `${present ? 'Add' : 'Remove'} ${definition.name}`, execute: () => apply(present), undo: () => apply(!present) })
	}

	/**
	 * Adds several components in one undoable step. Components the entity already has are left alone.
	 */
	addComponents(entity: Entity, parts: Readonly<Record<string, Readonly<Record<string, unknown>>>>): void {
		const guid = this.#guidOf(entity)
		if (guid === undefined) return
		const added: { readonly definition: RegisteredComponent; readonly init: Readonly<Record<string, unknown>> }[] = []
		for (const [name, init] of Object.entries(parts)) {
			const definition = this.registry.get(name)
			if (definition !== undefined && !this.world.has(entity, definition)) added.push({ definition, init })
		}
		if (added.length === 0) return
		this.#perform({
			kind: 'component',
			label: 'Add components',
			execute: () => {
				const target = this.#resolve(guid)
				if (target === undefined) return
				for (const { definition, init } of added) {
					if (!this.world.has(target, definition)) this.world.add(target, definition, init as Partial<ComponentData<FieldSchema>>)
				}
			},
			undo: () => {
				const target = this.#resolve(guid)
				if (target === undefined) return
				for (const { definition } of added) this.world.remove(target, definition)
			}
		})
	}

	setField(entity: Entity, definition: RegisteredComponent, field: string, value: number | string | boolean): void {
		const guid = this.#guidOf(entity)
		const data = this.world.get(entity, definition) as unknown as Record<string, unknown> | undefined
		if (guid === undefined || data === undefined || !(field in definition.schema) || data[field] === value) return
		this.#perform(
			this.#valueCommand<unknown>('component', `field:${guid}:${definition.name}:${field}`, `Edit ${definition.name}`, data[field], value, (next) => {
				const target = this.#resolve(guid)
				const stored = target === undefined ? undefined : (this.world.get(target, definition) as unknown as Record<string, unknown> | undefined)
				if (stored !== undefined) stored[field] = next
			})
		)
	}

	/**
	 * Moves an entity so its origin sits at a world position, converting through the parent's transform.
	 */
	setWorldPosition(entity: Entity, x: number, y: number): void {
		const link = this.world.get(entity, Parent)
		const parentMatrix = link === undefined ? undefined : this.transforms.worldMatrix(link.parent)
		if (parentMatrix === undefined) {
			this.setTransform(entity, { x, y })
			return
		}
		const inverse = parentMatrix.clone()
		if (!inverse.invert()) return
		const local = inverse.transformPoint(this.#scratch.set(x, y, 0))
		this.setTransform(entity, { x: local.x, y: local.y })
	}

	/**
	 * Places an entity at a world position and changes other transform fields in the same undoable step.
	 * Dragging a resize handle uses it, so one drag is one undo.
	 */
	setWorldPlacement(entity: Entity, x: number, y: number, patch: Readonly<Partial<TransformData>>): void {
		const link = this.world.get(entity, Parent)
		const parentMatrix = link === undefined ? undefined : this.transforms.worldMatrix(link.parent)
		let localX = x
		let localY = y
		if (parentMatrix !== undefined) {
			const inverse = parentMatrix.clone()
			if (!inverse.invert()) return
			const local = inverse.transformPoint(this.#scratch.set(x, y, 0))
			localX = local.x
			localY = local.y
		}
		this.setTransform(entity, { ...patch, x: localX, y: localY })
	}

	undo(): boolean {
		const command = this.#history.undo()
		if (command === undefined) return false
		this.#touch(command.kind as ChangeKind)
		return true
	}

	redo(): boolean {
		const command = this.#history.redo()
		if (command === undefined) return false
		this.#touch(command.kind as ChangeKind)
		return true
	}

	/**
	 * Entities in outline order: roots first by name, each followed by its children. Cached until the structure or a name changes.
	 */
	rows(): readonly EntityRow[] {
		if (this.#rows !== undefined) return this.#rows
		const info = new Map<Entity, { readonly id: Guid; readonly name: string }>()
		for (const entity of this.world.query(Identity)) {
			info.set(entity, { id: this.world.require(entity, Identity).guid as Guid, name: this.nameOf(entity) })
		}
		const byName = (a: Entity, b: Entity): number => {
			const left = info.get(a)
			const right = info.get(b)
			const leftKey = `${left?.name.toLowerCase() ?? ''}\u0000${left?.id ?? ''}`
			const rightKey = `${right?.name.toLowerCase() ?? ''}\u0000${right?.id ?? ''}`
			return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
		}
		const roots: Entity[] = []
		const children = new Map<Entity, Entity[]>()
		for (const entity of info.keys()) {
			const parent = this.world.get(entity, Parent)?.parent
			if (parent !== undefined && info.has(parent)) {
				const siblings = children.get(parent)
				if (siblings === undefined) children.set(parent, [entity])
				else siblings.push(entity)
			} else {
				roots.push(entity)
			}
		}
		roots.sort(byName)
		for (const siblings of children.values()) siblings.sort(byName)
		const rows: EntityRow[] = []
		const seen = new Set<Entity>()
		const stack: { readonly entity: Entity; readonly depth: number }[] = roots.reverse().map((entity) => ({ entity, depth: 0 }))
		while (stack.length > 0) {
			const { entity, depth } = stack.pop() as { readonly entity: Entity; readonly depth: number }
			const details = info.get(entity)
			if (details === undefined || seen.has(entity)) continue
			seen.add(entity)
			rows.push({ entity, id: details.id, name: details.name, depth })
			for (const child of [...(children.get(entity) ?? [])].reverse()) stack.push({ entity: child, depth: depth + 1 })
		}
		this.#rows = rows
		return rows
	}

	/**
	 * Writes the scene into the project and marks the current history position as saved.
	 */
	async save(): Promise<Result<void>> {
		const text = saveScene(this.world, this.registry)
		if (!text.ok) return text
		const written = await this.project.saveScene(MAIN_SCENE, text.value)
		if (written.ok) {
			this.#history.markClean()
			this.#announce('saved')
		}
		return written
	}

	dispose(): void {
		this.transforms.dispose()
		this.world.dispose()
		this.changed.clear()
	}

	#perform(command: UndoableCommand): void {
		this.#history.run(command)
		this.#touch(command.kind as ChangeKind)
	}

	#valueCommand<V>(kind: ChangeKind, mergeKey: string, label: string, from: V, to: V, apply: (value: V) => void): ValueCommand<V> {
		return {
			kind,
			label,
			mergeKey,
			to,
			execute: () => apply(to),
			undo: () => apply(from),
			merge: (next) =>
				next.mergeKey === mergeKey && 'to' in next ? this.#valueCommand(kind, mergeKey, label, from, (next as ValueCommand<V>).to, apply) : undefined
		}
	}

	#spawn(data: SpawnData): void {
		const entity = this.world.spawn()
		assignIdentity(this.world, entity, data.guid)
		this.world.add(entity, Name, { value: data.name })
		this.world.add(entity, Transform, { x: data.x, y: data.y })
		if (data.asset !== '') this.world.add(entity, Sprite, { asset: data.asset })
		for (const [name, init] of Object.entries(data.components)) {
			const definition = this.registry.get(name)
			if (definition !== undefined && !this.world.has(entity, definition)) this.world.add(entity, definition, init as Partial<ComponentData<FieldSchema>>)
		}
		const parent = data.parent === undefined ? undefined : this.#resolve(data.parent)
		if (parent !== undefined) this.transforms.setParent(entity, parent)
		this.#guids.set(data.guid, entity)
	}

	#remove(entity: Entity): void {
		const guids = this.#subtree(entity).map((member) => this.#guidOf(member))
		this.transforms.despawnTree(entity)
		for (const guid of guids) {
			if (guid !== undefined) this.#guids.delete(guid)
		}
		if (this.#selection !== undefined && !this.#isPersistent(this.#selection)) this.#selection = undefined
	}

	#subtree(root: Entity): Entity[] {
		const children = new Map<Entity, Entity[]>()
		for (const entity of this.world.query(Parent)) {
			const parent = this.world.get(entity, Parent)?.parent
			if (parent === undefined) continue
			const siblings = children.get(parent)
			if (siblings === undefined) children.set(parent, [entity])
			else siblings.push(entity)
		}
		const order: Entity[] = []
		const seen = new Set<Entity>()
		const stack: Entity[] = [root]
		while (stack.length > 0) {
			const entity = stack.pop() as Entity
			if (seen.has(entity)) continue
			seen.add(entity)
			order.push(entity)
			stack.push(...(children.get(entity) ?? []))
		}
		return order
	}

	#guidOf(entity: Entity): Guid | undefined {
		return this.world.get(entity, Identity)?.guid as Guid | undefined
	}

	#resolve(guid: Guid): Entity | undefined {
		const entity = this.#guids.get(guid)
		return entity !== undefined && this.#isPersistent(entity) ? entity : undefined
	}

	#isPersistent(entity: Entity): boolean {
		return this.world.isAlive(entity) && this.world.has(entity, Identity)
	}

	#touch(kind: ChangeKind): void {
		if (kind === 'structure' || kind === 'name') this.#rows = undefined
		this.#announce(kind)
	}

	#announce(kind: ChangeKind): void {
		try {
			this.changed.emit(kind)
		} catch (error: unknown) {
			this.#logger.error('Editor listener failed', error)
		}
	}
}
