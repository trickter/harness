---
name: planning-skill
description: Generate bounded candidate strategies and a first small action from a Goal Contract, artifact graph, and prior ledger. Use for DIVERGE_PLAN and after an escape decision.
---

# Planning

Return alternatives, risks, assumptions, and one next action that a worker can verify.

- Keep candidate strategies materially different from each other.
- Tie each strategy to allowed artifacts and verification.
- Do not execute the action while planning.

Read [references/planning-output.md](references/planning-output.md) for the output shape.
