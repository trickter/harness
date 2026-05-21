import assert from "node:assert/strict";
import test from "node:test";
import { ProgressEvaluator, type ProgressMetrics } from "../src/core/ProgressEvaluator.js";
import type { RunLedgerEntry } from "../src/core/RunLedger.js";

function entry(input: {
  iteration: number;
  errorSignature?: string;
  changedArtifacts: string[];
  metrics: ProgressMetrics;
}): RunLedgerEntry {
  return {
    iteration: input.iteration,
    phase: "VERIFY",
    goalId: "progress",
    action: "Run verification.",
    changedArtifacts: input.changedArtifacts,
    commandsRun: ["npm test"],
    verificationResult: "fail",
    errorSignature: input.errorSignature,
    progressSignal: "negative",
    newInformation: [],
    metrics: input.metrics,
    nextPhase: "REPAIR",
    timestamp: "2026-05-21T00:00:00.000Z"
  };
}

test("progress evaluator derives diff and failure trends and detects a worsening repair path", () => {
  const evaluator = new ProgressEvaluator();
  const firstSignature = "shell:test:test/auth.test.ts:42:9 after 18ms";
  const first = evaluator.evaluate([], {
    action: "Run verification.",
    changedArtifacts: ["src/auth/token.ts"],
    verificationResult: "fail",
    errorSignature: firstSignature,
    failureCount: 1,
    newInformation: []
  });
  const second = evaluator.evaluate(
    [
      entry({
        iteration: 1,
        errorSignature: firstSignature,
        changedArtifacts: ["src/auth/token.ts"],
        metrics: first.metrics
      })
    ],
    {
      action: "Run verification.",
      changedArtifacts: ["src/auth/token.ts", "src/auth/session.ts"],
      verificationResult: "fail",
      errorSignature: "shell:test:test/auth.test.ts:7:1 after 4ms",
      failureCount: 3,
      newInformation: []
    }
  );

  assert.equal(second.metrics.failureCountDelta, 2);
  assert.equal(second.metrics.diffArtifactsCount, 2);
  assert.equal(second.metrics.diffGrowthDelta, 1);
  assert.equal(second.metrics.diffGrowthStreak, 2);
  assert.equal(second.metrics.repeatedErrorCount, 1);
  assert.equal(second.metrics.gettingWorse, true);
  assert.equal(second.signal, "negative");
});

test("progress evaluator scores completion and confidence from a passing verification", () => {
  const result = new ProgressEvaluator().evaluate([], {
    action: "Verify goal.",
    changedArtifacts: ["src/auth/token.ts"],
    verificationResult: "pass",
    failureCount: 0,
    newInformation: ["Verification closed the goal."],
    objectiveDelta: 0.4,
    successCriteriaMet: true
  });

  assert.equal(result.metrics.goalCompletionScore, 1);
  assert.equal(result.metrics.failureCountDelta, 0);
  assert.ok(result.metrics.confidenceDelta > 0);
  assert.ok(result.metrics.confidenceScore > 0);
  assert.equal(result.signal, "positive");
});
