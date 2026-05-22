import assert from "node:assert/strict";
import test from "node:test";
import {
  createGoalContractFromNaturalLanguage,
  DEFAULT_BUDGET,
  DEFAULT_SCOPE,
  parseGoalContract
} from "../src/core/GoalContract.js";

test("goal contracts normalize plan-style snake_case fields and apply conservative defaults", () => {
  const contract = parseGoalContract({
    goal: {
      id: "report",
      name: "Report",
      objective: "Create a report.",
      expected_outputs: ["reports/out.md"]
    },
    success_criteria: ["Report is verified."],
    scope: {
      allowed_artifacts: ["reports/**"],
      allowed_operations: ["fs:read", "fs:write"]
    }
  });

  assert.deepEqual(contract.goal.expectedOutputs, ["reports/out.md"]);
  assert.deepEqual(contract.successCriteria, ["Report is verified."]);
  assert.equal(contract.budget.maxIterations, DEFAULT_BUDGET.maxIterations);
  assert.equal(contract.riskPolicy.destructiveActions, "forbidden");
  assert.equal(contract.riskPolicy.secretAccess, "forbidden");
  assert.deepEqual(contract.scope.forbiddenArtifacts, DEFAULT_SCOPE.forbiddenArtifacts);
  assert.deepEqual(contract.scope.forbiddenOperations, DEFAULT_SCOPE.forbiddenOperations);
});

test("goal contracts can explicitly override default forbidden scope fields", () => {
  const contract = parseGoalContract({
    goal: {
      id: "sandbox",
      name: "Sandbox",
      objective: "Run inside a disposable sandbox."
    },
    scope: {
      forbiddenArtifacts: [],
      forbiddenOperations: []
    }
  });

  assert.deepEqual(contract.scope.forbiddenArtifacts, []);
  assert.deepEqual(contract.scope.forbiddenOperations, []);
});

test("natural-language code goals infer a complete conservative contract", () => {
  const contract = createGoalContractFromNaturalLanguage({
    name: "Session Refactor",
    objective:
      "Refactor the TypeScript session module in src/auth/session.ts and add coverage in test/auth/session.test.ts."
  });

  assert.deepEqual(contract.goal.expectedOutputs, ["src/auth/session.ts", "test/auth/session.test.ts"]);
  assert.match(contract.successCriteria[0] ?? "", /compatible/);
  assert.deepEqual(contract.verification.commands, ["npm test", "npm run check"]);
  assert.ok(contract.verification.checks.length > 0);
  assert.ok(contract.verification.qualityGates.length > 0);
  assert.ok(contract.scope.allowedArtifacts.includes("src/**"));
  assert.ok(contract.scope.allowedArtifacts.includes("test/auth/session.test.ts"));
  assert.ok(contract.scope.allowedOperations.includes("shell:typecheck"));
  assert.deepEqual(contract.scope.forbiddenArtifacts, DEFAULT_SCOPE.forbiddenArtifacts);
  assert.equal(contract.riskPolicy.profile, "workspace");
});

test("natural-language model goals infer experiment scope and verification checks", () => {
  const contract = createGoalContractFromNaturalLanguage({
    name: "Baseline Metrics",
    objective: "Train a baseline model from data/train.csv and report validation metrics without leakage."
  });

  assert.deepEqual(contract.goal.expectedOutputs, ["data/train.csv"]);
  assert.ok(contract.scope.allowedArtifacts.includes("models/**"));
  assert.ok(contract.scope.allowedOperations.includes("shell:train"));
  assert.ok(contract.scope.allowedOperations.includes("shell:evaluate"));
  assert.match(contract.successCriteria.join(" "), /metrics/i);
  assert.match(contract.verification.checks.join(" "), /leakage/i);
});

test("natural-language risky goals make high-risk policy explicit", () => {
  const contract = createGoalContractFromNaturalLanguage({
    name: "Production Cleanup",
    objective: "Delete stale production release artifacts and publish notes with a release token."
  });

  assert.equal(contract.riskPolicy.profile, "production");
  assert.equal(contract.riskPolicy.destructiveActions, "require_explicit_approval");
  assert.equal(contract.riskPolicy.secretAccess, "restricted");
  assert.equal(contract.riskPolicy.externalNetwork, "restricted");
});
