# 0001: Core architecture

## Status

Accepted.

## Package layers

Imports flow downward only. Nothing below may import anything above it.

1. `@strata/math` and `@strata/core` (universal): vectors, matrices, ids, the entity world, scheduling, events, serialization, diagnostics, resource ownership.
2. Engine systems (renderer, physics, audio, assets, input, animation, scripting, networking): browser or universal, depending on `@strata/core`.
3. `@strata/runtime` (browser): composes systems into a playable game. It never imports the editor.
4. Editor, cloud service and desktop shell (apps): consume the runtime. The cloud service is the only server package.

Exported games contain layers 1 to 3 only. They contain no editor code and no Gambrel code.

## World model

- One entity world is the single source of truth for gameplay and editing.
- An entity is a 32-bit handle: 20 bits of index and 12 bits of generation. A stale handle is detected, never reused silently.
- Components are declared with a typed schema, so serialization, inspection and networking share one definition.
- Storage is a sparse set per component type. Queries use cached component masks.
- Hierarchy is a `Parent` component. A hierarchy system keeps child lists and propagates dirty transforms.
- Systems are functions registered into ordered stages with explicit dependencies. Stage order is validated at startup.

## Time and determinism

- Simulation runs at a fixed timestep, separate from rendering, with interpolation for display.
- Simulation randomness comes from a seeded PCG32 generator. `Math.random` is forbidden in simulation code.
- ECMAScript does not fix the precision of functions such as `Math.sin`, so deterministic mode uses Strata's own implementations. Basic arithmetic and `Math.sqrt` are safe to rely on.

## Serialization

- Project and scene files are JSON with an integer `formatVersion` and an ordered chain of migrations.
- Entities are saved with a random 128-bit stable id. Runtime handles are never persisted.
- Baked runtime assets use compact binary formats with explicit version headers. Wire formats are append-only.

## Errors and resources

- Programmer errors throw `StrataError` with a stable code. Expected failures at input and storage boundaries return a typed result.
- Anything that owns a resource implements `Disposable` (`dispose()`), and containers release their children. Strata does not rely on `Symbol.dispose`, because browser support varies.
- Libraries do not write to `console`. They report through a diagnostics sink.

## Consequences

- Package platform labels and import direction are enforced by `bun run audit`.
- The editor can operate on a live world, which makes play-in-editor and undo/redo share one data model.
- Deterministic simulation limits what can be used in gameplay code and will be documented for script authors.
