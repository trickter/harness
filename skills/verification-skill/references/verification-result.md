# Verification Result

```json
{
  "result": "fail",
  "commandsRun": ["npm test -- webhook"],
  "checks": ["invalid signature rejected"],
  "qualityGates": ["unit tests"],
  "errorSignature": "unit-test:signature rejects missing header:assertion",
  "failureCount": 1,
  "newInformation": ["Missing header currently becomes an empty HMAC input."]
}
```
