# Supervisor Decision

```json
{
  "phase": "CONVERGE_EXECUTE",
  "decision": "continue",
  "action": {
    "summary": "Run focused webhook verification.",
    "operation": "shell:test",
    "artifacts": ["test/webhooks/**"]
  },
  "reason": "The action is allowed and narrows the current error signature."
}
```
