# Planning Output

```json
{
  "phase": "DIVERGE_PLAN",
  "assumptions": ["The target route already has request body access."],
  "strategies": [
    {
      "id": "existing-middleware",
      "summary": "Extend current middleware layer.",
      "risk": "Body canonicalization may already be consumed."
    }
  ],
  "selectedStrategyId": "existing-middleware",
  "nextAction": {
    "summary": "Inspect webhook route and current middleware tests.",
    "operation": "fs:read",
    "artifacts": ["src/webhooks/**", "test/**"]
  }
}
```
