# Codex Autonomous Harness

Codex Autonomous Harness is a policy-bound runtime for autonomous Codex `/goal` work. It keeps goal contracts, scope, permissions, ledger entries, verification, recovery, skills, and daemon reports explicit while Codex advances a run.

## Requirements

- Node.js 22 or newer
- Git for snapshots, scope audit, and recovery
- Codex CLI only when using the experimental `harness codex-run` subprocess path

## Quickstart

```powershell
npm ci
npm test
npm run build
node dist/src/cli/index.js init-contract `
  --name "Webhook Signature" `
  --objective "Add TypeScript webhook signature verification in src/webhooks and cover it with tests." `
  --out goal.yaml
node dist/src/cli/index.js start --contract goal.yaml --run .harness/runs/webhook-signature
```

`init-contract` infers a conservative Goal Contract from the natural-language objective. Use `--template` when a deliberately blank draft is needed.

For Codex `/goal` driven runs, keep Codex in control of edits and use the harness CLI as the contract, ledger, verification, audit, and recovery surface:

```powershell
node dist/src/cli/index.js resume --run .harness/runs/webhook-signature
node dist/src/cli/index.js turn --run .harness/runs/webhook-signature --phase DIVERGE_PLAN --action "Plan bounded action" --verification skipped --selected-strategy-ready
node dist/src/cli/index.js verify --run .harness/runs/webhook-signature
node dist/src/cli/index.js recover --run .harness/runs/webhook-signature
```

## Core CLI

- `harness init-contract` creates a conservative contract from a natural-language objective.
- `harness start`, `status`, `resume`, `turn`, and `verify` manage a run directory and ledger.
- `harness audit`, `snapshot`, `diff`, and `recover` inspect and restore workspace state.
- `harness skills validate` validates local `SKILL.md` files and harness output schemas.
- `harness daemon dispatch` sends one daemon trigger event.
- `harness daemon serve` runs file-change and scheduled daemon triggers until the process receives `SIGINT` or `SIGTERM`.

Use `node dist/src/cli/index.js --help` in a checkout or the installed `harness` binary after packaging.

## Codex Skill

The primary runtime skill is [skills/autonomous-harness/SKILL.md](skills/autonomous-harness/SKILL.md). Install or link the repository `skills/` entries into the Codex skills directory used by the local Codex environment, then validate them before use:

```powershell
node dist/src/cli/index.js skills validate --root skills
```

`autonomous-harness` describes the `/goal` workflow. The supporting contract, planning, execution, verification, progress, escape, recovery, artifact, and daemon skills live beside it.

## Development

```powershell
npm run build
npm test
```

Tests compile TypeScript to `dist/` first and then run the Node test suite from the compiled output.

## Release Policy

Release and versioning steps are documented in [RELEASE.md](RELEASE.md).
