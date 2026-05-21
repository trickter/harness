# Artifact Graph

```json
{
  "artifacts": [
    {
      "id": "src-webhook-signature",
      "type": "source_code",
      "uri": "src/webhooks/signature.ts",
      "metadata": {}
    }
  ],
  "edges": [
    {
      "from": "test-webhook-signature",
      "to": "src-webhook-signature",
      "relation": "tests"
    }
  ]
}
```
