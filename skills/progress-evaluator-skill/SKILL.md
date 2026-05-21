---
name: progress-evaluator-skill
description: Judge real progress from metrics, contract, and a ledger window. Use after verification to recommend continue, repair, escape, finish, or stop.
---

# Progress Evaluation

Use evidence from the ledger rather than optimism.

- Treat repeated failures, rising failure counts, growing diffs, drift, and artifact churn as negative signals.
- Treat new verified information as progress only when it narrows the contract path.
- Prefer completion and confidence scores that are grounded in verification, failure trend, and scope evidence.
- Recommend escape when the same error or no-progress budget is consumed.

Read [references/progress-decision.md](references/progress-decision.md) for the decision shape.
