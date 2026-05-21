---
name: daemon-agent-skill
description: Define short-lived supervised daemon runs with trigger, scope, budget, output mode, and stop conditions. Use for maintenance tasks such as documentation consistency checks.
---

# Daemon Agent

Daemons stay bounded by the same ledger and supervisor policies as ordinary runs.

- Default to `report_only`.
- Set trigger, scope, maximum runtime, action budget, and stop conditions.
- Do not let a trigger bypass permission checks.

Read [references/daemon-spec.md](references/daemon-spec.md) for the daemon spec and documentation example.
