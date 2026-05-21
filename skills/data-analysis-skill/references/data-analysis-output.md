# Data Analysis Output Schema

```yaml
datasetPath: data/sample.csv
summary:
  rowCount: 1000
  columnCount: 5
findings:
  - "Missing values detected in column 'age' (12%)."
  - "Outliers found in 'income' column above $500,000."
confidenceStatement: "Suitable for modeling with imputations on 'age'."
```
