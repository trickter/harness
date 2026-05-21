# Recovery Report Format

```yaml
status: failed_run
revertAdvice:
  - path: src/broken-file.ts
    reason: "Code contains syntax error and cannot be compiled."
keepAdvice:
  - path: src/working-helper.ts
    reason: "Helper functions are well tested and correct."
recoverySteps:
  - "git checkout HEAD -- src/broken-file.ts"
  - "npm run check"
```
