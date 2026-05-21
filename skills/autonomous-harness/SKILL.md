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
3. Start a run directory with `harness start --contract <goal.yaml> [--cwd <repo>]`. This captures the `baseline` snapshot. Use the returned `runDir` for the rest of the goal.
4. Use `harness status --run <runDir>` before deciding the next step, and `harness resume --run <runDir>` after interruptions.
5. Record planning before execution:
   - phase: `DIVERGE_PLAN` or `ESCAPE_DIVERGE`
   - verification: `skipped`
   - include `--selected-strategy-ready` or `--alternative-strategy-selected` only when the next action is bounded and permission-compatible.
6. Execute exactly one bounded action directly in the current Codex session.
7. Audit real workspace changes with `harness audit --run <runDir> --since baseline [--cwd <repo>]`. If audit fails, stop and ask the user unless the out-of-scope change is intentionally approved.
8. Record the action with `harness turn`:
   - phase: `CONVERGE_EXECUTE` or `REPAIR`
   - verification: `skipped`
   - include changed artifacts, commands run, new information, and `--action-completed` or `--repair-completed`.
9. Verify with `harness verify --run <runDir> [--cwd <dir>]`.
10. Inspect status with `harness status --run <runDir>` and continue from `phase`.
11. Stop only when the status reaches `FINISH`, `NEED_HUMAN`, or `ABORT`.

## Command Templates

Planning:

```bash
harness start --contract goal.yaml
harness status --run .harness/runs/<goal-id>
harness turn --run .harness/runs/<goal-id> --phase DIVERGE_PLAN --action "Plan next bounded action" --verification skipped --hypothesis "..." --info "..." --selected-strategy-ready
```

Execution:

```bash
harness audit --run .harness/runs/<goal-id> --since baseline
harness turn --run .harness/runs/<goal-id> --phase CONVERGE_EXECUTE --action "Implement one bounded change" --verification skipped --changed src/file.ts --info "..." --action-completed --objective-delta 0.1
```

Repair:

```bash
harness audit --run .harness/runs/<goal-id> --since baseline
harness turn --run .harness/runs/<goal-id> --phase REPAIR --action "Repair the current verification failure" --verification skipped --changed src/file.ts --info "..." --repair-completed --objective-delta 0.1
```

Verification:

```bash
harness verify --run .harness/runs/<goal-id>
harness resume --run .harness/runs/<goal-id>
```

## Rules

- Keep every action small enough to verify immediately.
- Treat `harness audit` as authoritative for actual changed files; do not rely only on self-reported `--changed` paths.
- Run `harness run --dry-policy` before high-risk operations or when scope is unclear.
- If `nextPhase` is `NEED_HUMAN`, stop and ask the user.
- If `nextPhase` is `ESCAPE_DIVERGE`, summarize the failed path, generate at least three different hypotheses, choose a materially different strategy, then record an escape planning turn.
- If verification repeatedly fails with the same signature, do not keep patching the same hypothesis.
