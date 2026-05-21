import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_BUDGET, parseGoalContract } from "../src/core/GoalContract.js";

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
  assert.deepEqual(contract.scope.forbiddenOperations, []);
});
