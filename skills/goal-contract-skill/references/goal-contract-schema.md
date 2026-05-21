# Goal Contract Shape

Use camelCase field names when sending data to the TypeScript runtime.

```yaml
goal:
  id: webhook-signature
  name: Webhook Signature Module
  objective: Add request signature verification.
  background: Existing route accepts unsigned webhooks.
  expectedOutputs: [src/webhooks/signature.ts, test coverage]
scope:
  allowedArtifacts: [src/**, test/**]
  forbiddenArtifacts: [.env*, secrets/**]
  allowedOperations: [fs:read, fs:write, shell:test, shell:typecheck]
  forbiddenOperations: [git:push, fs:delete]
successCriteria: [Valid signatures pass, Invalid signatures fail]
verification:
  commands: [npm test]
  checks: [changed module has tests]
  qualityGates: [tests pass]
budget:
  maxIterations: 12
  maxSameError: 2
  maxNoProgress: 3
  maxEscapeRounds: 2
  maxChangedArtifacts: 8
  maxRuntimeMinutes: 30
riskPolicy:
  destructiveActions: forbidden
  externalNetwork: restricted
  secretAccess: forbidden
stopConditions:
  success: [all success criteria satisfied]
  fail: [permission denied without approval]
```
