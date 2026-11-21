# Changelog

## Unreleased

- Repository foundation: TypeScript configuration, dependency audit, commit linting and CI.
- Dependency audit enforces per-package platform boundaries and normalizes Windows paths.
- Dependabot commits follow the conventional commit format.
- Core package: entity world with typed components, scheduler, events, disposal, results and a fixed timestep.
- Core package: versioned document envelopes with migrations, stable ids and a structured logger.
- Core package: component registry, persistent identity and atomic world snapshots.
- Math package: scalar helpers, vectors, quaternions, matrices, seeded PCG32 generator and deterministic trigonometry.
- Scene package: transforms, names, parent hierarchy with cycle protection and versioned scene files.
- Renderer package: WebGPU and WebGL2 sprite rendering with automatic fallback and graphics loss recovery.
- Playground app for exercising the renderer in a browser.
- Input package: keyboard, pointer, touch and gamepad input with rebindable action maps.
- Project package: validated project storage, content-addressed asset library with PNG and WAV import, and scene files.
- Storage package for the browser's origin private file system, and image decoding in the renderer.
- Editor: project launcher, workspace with hierarchy, inspector and viewport, and an editor session package.
