import assert from "node:assert/strict";
import test from "node:test";
import { normalizeErrorSignature, VerificationParser } from "../src/core/VerificationParser.js";

const parser = new VerificationParser();

test("verification parser extracts TypeScript diagnostics", () => {
  const parsed = parser.parse({
    command: "npm run check",
    operation: "shell:typecheck",
    exitCode: 2,
    stdout: "",
    stderr: "src/app.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.\n"
  });

  assert.equal(parsed.failureCount, 1);
  assert.match(parsed.errorSignature ?? "", /TS2322/);
});

test("verification parser extracts test runner failure summaries", () => {
  const parsed = parser.parse({
    command: "npm test",
    operation: "shell:test",
    exitCode: 1,
    stdout: "FAIL test/auth.test.ts\nTests: 2 failed, 5 passed, 7 total\n",
    stderr: ""
  });

  assert.equal(parsed.failureCount, 2);
  assert.match(parsed.errorSignature ?? "", /test\/auth\.test\.ts/);
});

test("verification parser extracts Jest failure details", () => {
  const parsed = parser.parse({
    command: "npx jest --runInBand",
    operation: "shell:test",
    exitCode: 1,
    stdout: "FAIL test/session.test.ts\n  ● sessions > rejects invalid cookie\n\nTests:       1 failed, 4 passed, 5 total\n",
    stderr: ""
  });

  assert.equal(parsed.failureCount, 1);
  assert.match(parsed.errorSignature ?? "", /jest-vitest:FAIL test\/session\.test\.ts/);
});

test("verification parser extracts Vitest failure details", () => {
  const parsed = parser.parse({
    command: "npx vitest run",
    operation: "shell:test",
    exitCode: 1,
    stdout: "FAIL  test/auth.test.ts > tokens > rejects expired token\n Test Files  1 failed | 2 passed (3)\n      Tests  2 failed | 8 passed (10)\n",
    stderr: ""
  });

  assert.equal(parsed.failureCount, 2);
  assert.match(parsed.errorSignature ?? "", /jest-vitest:FAIL test\/auth\.test\.ts/);
  assert.match(parsed.summary, /Jest\/Vitest/);
});

test("verification parser extracts pytest node ids", () => {
  const parsed = parser.parse({
    command: "pytest -q",
    operation: "shell:test",
    exitCode: 1,
    stdout: "FAILED tests/test_auth.py::test_rejects_invalid - AssertionError: expected 401\n=== 2 failed, 5 passed in 0.14s ===\n",
    stderr: ""
  });

  assert.equal(parsed.failureCount, 2);
  assert.match(parsed.errorSignature ?? "", /pytest:FAILED tests\/test_auth\.py::test_rejects_invalid/);
});

test("verification parser extracts ESLint diagnostics", () => {
  const parsed = parser.parse({
    command: "npx eslint src",
    operation: "shell:verify",
    exitCode: 1,
    stdout: "src/auth.ts\n  4:9  error  'token' is assigned a value but never used  no-unused-vars\n\n✖ 2 problems (2 errors, 0 warnings)\n",
    stderr: ""
  });

  assert.equal(parsed.failureCount, 2);
  assert.match(parsed.errorSignature ?? "", /eslint:<loc> error/);
});

test("verification parser extracts build tool failures", () => {
  const parsed = parser.parse({
    command: "vite build",
    operation: "shell:verify",
    exitCode: 1,
    stdout: "error during build:\n[vite]: Rollup failed to resolve import \"./missing\" from \"src/main.ts\".\n",
    stderr: ""
  });

  assert.equal(parsed.failureCount, 1);
  assert.match(parsed.errorSignature ?? "", /build:error during build/);
});

test("verification parser extracts data quality check failures", () => {
  const parsed = parser.parse({
    command: "node scripts/check-csv.mjs data/sample.csv",
    operation: "shell:data-check",
    exitCode: 1,
    stdout: "DATA QUALITY CHECK FAILED: missing_values=3\nfailed_checks: 2\n",
    stderr: ""
  });

  assert.equal(parsed.failureCount, 2);
  assert.match(parsed.errorSignature ?? "", /data-quality:DATA QUALITY CHECK FAILED/);
});

test("verification parser extracts model metric gate failures", () => {
  const parsed = parser.parse({
    command: "node scripts/evaluate-pipeline.mjs",
    operation: "shell:evaluate",
    exitCode: 1,
    stdout: "METRIC GATE FAILED: validation accuracy 0.71 below threshold 0.80\nmetric_failures: 1\n",
    stderr: ""
  });

  assert.equal(parsed.failureCount, 1);
  assert.match(parsed.errorSignature ?? "", /model-metrics:METRIC GATE FAILED/);
});

test("verification parser falls back to command exit signatures", () => {
  const parsed = parser.parse({
    command: "node custom-check.js",
    operation: "shell:verify",
    exitCode: 9,
    stdout: "",
    stderr: "custom failure"
  });

  assert.equal(parsed.failureCount, 1);
  assert.equal(parsed.errorSignature, "shell:verify:node custom-check.js:exit-9");
});

test("error signatures normalize dynamic locations, durations, and ids", () => {
  assert.equal(
    normalizeErrorSignature("FAIL C:\\tmp\\repo\\test\\auth.test.ts:42:9 after 18.2ms id deadbeefdeadbeef"),
    normalizeErrorSignature("FAIL C:/tmp/repo/test/auth.test.ts:7:1 after 4.5ms id feedfacefeedface")
  );
});
