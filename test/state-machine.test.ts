import assert from "node:assert/strict";
import test from "node:test";
import { parseGoalContract } from "../src/core/GoalContract.js";
import { type ProgressMetrics } from "../src/core/ProgressEvaluator.js";
import { StateMachine } from "../src/core/StateMachine.js";

const metrics: ProgressMetrics = {
  objectiveDelta: 0,
  errorSignatureChanged: false,
  failureCountDelta: 0,
  newInformationFound: false,
  artifactQualityDelta: 0,
  scopeDriftScore: 0,
  repeatedActionCount: 1,
  repeatedErrorCount: 2,
  noProgressCount: 0,
  changedArtifactsCount: 1,
  confidenceDelta: 0
};

test("verify enters escape divergence once repeated error budget is consumed", () => {
  const contract = parseGoalContract({
    goal: {
      id: "escape",
      name: "Escape",
      objective: "Escape repeated errors."
    },
    budget: {
      maxIterations: 8,
      maxSameError: 2,
      maxNoProgress: 3,
      maxEscapeRounds: 1,
      maxChangedArtifacts: 4,
      maxRuntimeMinutes: 5
    }
  });
  const transition = new StateMachine().transition("VERIFY", contract, {
    metrics,
    verificationResult: "fail",
    escapeRounds: 0
  });

  assert.equal(transition.to, "ESCAPE_DIVERGE");
});

test("verify finishes a passing contract before applying a budget stop reason", () => {
  const contract = parseGoalContract({
    goal: {
      id: "finish",
      name: "Finish",
      objective: "Finish after verification."
    }
  });
  const transition = new StateMachine().transition("VERIFY", contract, {
    metrics: {
      ...metrics,
      repeatedErrorCount: 0
    },
    verificationResult: "pass",
    successCriteriaMet: true,
    stopReason: "maximum iteration budget reached",
    escapeRounds: 0
  });

  assert.equal(transition.to, "FINISH");
});
