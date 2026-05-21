# Escape Output

```json
{
  "failedPath": "Repeatedly adjusted HMAC comparison while tests still fail on body bytes.",
  "hypotheses": [
    "Request body is re-encoded before verification.",
    "Header timestamp format is included in the signed payload.",
    "The fixture uses a different digest encoding."
  ],
  "selectedStrategy": "Inspect fixture payload construction before another comparison change."
}
```
