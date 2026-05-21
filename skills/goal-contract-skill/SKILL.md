---
name: goal-contract-skill
description: Convert a natural-language goal into a conservative Goal Contract for a supervised harness run. Use at run initialization before planning, especially when scope, verification, budget, or risk policy must be made explicit.
---

# Goal Contract

Produce a structured contract before any execution starts.

1. Convert the goal into expected outputs and verifiable success criteria.
2. Keep scope explicit: list allowed artifacts and operations before forbidden ones.
3. Default missing high-risk permissions to restricted or forbidden.
4. Report missing information when success or risk cannot be completed safely.

Read [references/goal-contract-schema.md](references/goal-contract-schema.md) when producing or checking the contract shape.
