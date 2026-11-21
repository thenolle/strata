# Changelog

## Unreleased

- Repository foundation: TypeScript configuration, dependency audit, commit linting and CI.
- Dependency audit enforces per-package platform boundaries and normalizes Windows paths.
- Dependabot commits follow the conventional commit format.
- Core package: entity world with typed components, scheduler, events, disposal, results and a fixed timestep.
- Core package: versioned document envelopes with migrations, stable ids and a structured logger.
- Core package: component registry, persistent identity and atomic world snapshots.
- Math package: scalar helpers, vectors, quaternions, matrices, seeded PCG32 generator and deterministic trigonometry.
- Scene package: transforms, parent hierarchy with cycle protection and versioned scene files.
