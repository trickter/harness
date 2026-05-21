---
name: verification-skill
description: Verify a supervised action and normalize failures into error signatures. Use after every execution or repair action before progress is evaluated.
---

# Verification

Prefer contract verification commands and stable checks.

- Distinguish pass, fail, partial, and skipped.
- Normalize failure identity from failing check, assertion, exit code, and top stack/log context.
- Do not fix code while verifying.

Read [references/verification-result.md](references/verification-result.md) for the output shape.
