---
name: autonomous-harness
description: Run a Codex /goal task under the Autonomous Harness protocol using this repository's deterministic CLI for Goal Contract, Run Ledger, state transitions, verification, progress evaluation, and bounded daemon checks. Use when Codex itself is the active /goal agent and must operate autonomously without spawning another Codex process from TypeScript.
---

# Autonomous Harness

Use this skill when the current Codex session is the agent doing the work. The TypeScript code is the deterministic harness, not the agent runtime.

Do not use `harness codex-run`, `CodexCliAdapter`, or any code path that launches another Codex process unless the user explicitly asks for nested Codex execution.

## Workflow

1. Build first when source changed: `npm run build`.
2. Create or load a Goal Contract. Prefer `harness init-contract` for a draft, then edit the YAML only when the user has asked for implementation.
3. Use one ledger for the whole goal, normally `.harness/runs/<goal-id>/ledger.jsonl`.
4. Record planning before execution:
   - phase: `DIVERGE_PLAN` or `ESCAPE_DIVERGE`
   - verification: `skipped`
   - include `--selected-strategy-ready` or `--alternative-strategy-selected` only when the next action is bounded and permission-compatible.
5. Execute exactly one bounded action directly in the current Codex session.
6. Record the action with `harness turn`:
   - phase: `CONVERGE_EXECUTE` or `REPAIR`
   - verification: `skipped`
   - include changed artifacts, commands run, new information, and `--action-completed` or `--repair-completed`.
7. Verify with `harness verify --contract <contract> --ledger <ledger> [--cwd <dir>]`.
8. Inspect ledger with `harness ledger inspect <ledger>` and continue from `nextPhase`.
9. Stop only when the ledger reaches `FINISH`, `NEED_HUMAN`, or `ABORT`.

## Command Templates

Planning:

```bash
harness turn --contract goal.yaml --ledger .harness/runs/<goal-id>/ledger.jsonl --phase DIVERGE_PLAN --action "Plan next bounded action" --verification skipped --hypothesis "..." --info "..." --selected-strategy-ready
```

Execution:

```bash
harness turn --contract goal.yaml --ledger .harness/runs/<goal-id>/ledger.jsonl --phase CONVERGE_EXECUTE --action "Implement one bounded change" --verification skipped --changed src/file.ts --info "..." --action-completed --objective-delta 0.1
```

Repair:

```bash
harness turn --contract goal.yaml --ledger .harness/runs/<goal-id>/ledger.jsonl --phase REPAIR --action "Repair the current verification failure" --verification skipped --changed src/file.ts --info "..." --repair-completed --objective-delta 0.1
```

Verification:

```bash
harness verify --contract goal.yaml --ledger .harness/runs/<goal-id>/ledger.jsonl
```

## Rules

- Keep every action small enough to verify immediately.
- Run `harness run --dry-policy` before high-risk operations or when scope is unclear.
- If `nextPhase` is `NEED_HUMAN`, stop and ask the user.
- If `nextPhase` is `ESCAPE_DIVERGE`, summarize the failed path, generate at least three different hypotheses, choose a materially different strategy, then record an escape planning turn.
- If verification repeatedly fails with the same signature, do not keep patching the same hypothesis.
