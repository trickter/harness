import assert from "node:assert/strict";
import test from "node:test";
import { parseGoalContract } from "../src/core/GoalContract.js";
import { type ProgressMetrics } from "../src/core/ProgressEvaluator.js";
import { StateMachine } from "../src/core/StateMachine.js";

const metrics: ProgressMetrics = {
  objectiveDelta: 0,
  errorSignatureChanged: false,
  failureCount: 0,
  failureCountDelta: 0,
  newInformationFound: false,
  artifactQualityDelta: 0,
  scopeDriftScore: 0,
  repeatedActionCount: 1,
  repeatedErrorCount: 2,
  noProgressCount: 0,
  changedArtifactsCount: 1,
  diffArtifactsCount: 1,
  diffGrowthDelta: 0,
  diffGrowthStreak: 0,
  goalCompletionScore: 0,
  confidenceDelta: 0,
  confidenceScore: 0,
  worseningScore: 0,
  gettingWorse: false
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

test("escape budget allows the current escape round to select an alternative strategy", () => {
  const contract = parseGoalContract({
    goal: {
      id: "single-escape",
      name: "Single Escape",
      objective: "Complete one escape round."
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
  const transition = new StateMachine().transition("ESCAPE_DIVERGE", contract, {
    metrics,
    alternativeStrategySelected: true,
    escapeRounds: 1
  });

  assert.equal(transition.to, "CONVERGE_EXECUTE");
});

test("escape budget aborts when another escape round would be entered", () => {
  const contract = parseGoalContract({
    goal: {
      id: "escape-budget",
      name: "Escape Budget",
      objective: "Stop extra escape rounds."
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
    escapeRounds: 1
  });

  assert.equal(transition.to, "ABORT");
});
