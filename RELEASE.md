# Release Policy

This package follows semantic versioning through the `version` field in `package.json`.

## Version Rules

- Patch: fixes, parser improvements, and policy hardening that preserve public contracts.
- Minor: new CLI commands, new runtime APIs, new built-in scenarios, and new daemon or skill capabilities.
- Major: incompatible Goal Contract, ledger, CLI, recovery, or permission semantics.

## Release Checklist

1. Confirm the worktree is clean and `main` is current.
2. Run `npm ci`, `npm test`, and `npm pack --dry-run`.
3. Update `package.json` and `package-lock.json` version fields together.
4. Summarize user-visible behavior changes and migration notes in the release entry.
5. Tag the tested commit as `v<version>` after CI passes.

Do not publish a release when permission-policy behavior, recovery behavior, or Goal Contract defaults changed without focused tests.
