# Contributing

## Licence and contributions

Strata uses the PolyForm Strict License 1.0.0, which does not grant redistribution or derivative-work rights. Open an issue and agree on the approach before sending code. By submitting a pull request you confirm that you wrote the change and allow the maintainer to include it in the project under its licence.

## Ground rules

- No new dependencies. `bun run audit` fails the build if one appears.
- Strict TypeScript, ESM, no semicolons, single quotes, tab indentation.
- Keep modules small and cohesive, and document public APIs with TSDoc.

## Workflow

1. Branch from `master`. Never push directly to `master`.
2. Run `bun run check` before pushing.
3. Add an entry under Unreleased in `CHANGELOG.md` and update the relevant page in `docs/`.
4. Open a pull request using the template. Pull requests are squash-merged.

## Commit messages

Use `type(scope): description` in lower case, without a trailing period, at most 72 characters.

Allowed types: `feat`, `fix`, `docs`, `chore`, `ci`, `build`, `test`, `perf`, `refactor`, `revert`.

Enable the local check with `bun run hooks`. CI applies the same rules to every commit in a pull request. Pull request titles follow the same format because they become the squash commit message.
