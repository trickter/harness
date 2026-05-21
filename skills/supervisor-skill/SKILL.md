---
name: supervisor-skill
description: Decide the next supervised phase from contract, ledger, verification, diff scope, and budgets. Use at each loop control point; never use it for direct file edits.
---

# Supervisor

Keep phase, scope, budget, and permission decisions separate from worker execution.

- Stop or require human input when contract risk is incomplete.
- Reject worker actions that broaden scope without a new contract decision.
- Explain the evidence behind continue, repair, escape, finish, or abort.

Read [references/supervisor-decision.md](references/supervisor-decision.md) for the decision shape.
