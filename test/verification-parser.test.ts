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
