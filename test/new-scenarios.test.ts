import assert from "node:assert/strict";
import test from "node:test";
import { createRefactorScenario } from "../src/scenarios/RefactorScenario.js";
import { createAutoModelingScenario } from "../src/scenarios/AutoModelingScenario.js";
import { createDailyWorkScenario } from "../src/scenarios/DailyWorkScenario.js";

test("refactor scenario compiles and parses correctly", () => {
  const contract = createRefactorScenario();
  assert.equal(contract.goal.id, "module-refactor");
  assert.equal(contract.scope.allowedArtifacts.includes("src/**"), true);
  assert.equal(contract.successCriteria.length > 0, true);
});

test("auto modeling scenario compiles and parses correctly", () => {
  const contract = createAutoModelingScenario();
  assert.equal(contract.goal.id, "dataset-auto-modeling");
  assert.equal(contract.scope.allowedArtifacts.includes("models/**"), true);
  assert.equal(contract.successCriteria.length > 0, true);
});

test("daily work scenario compiles and parses correctly", () => {
  const contract = createDailyWorkScenario();
  assert.equal(contract.goal.id, "daily-automation");
  assert.equal(contract.scope.allowedArtifacts.includes("docs/**"), true);
  assert.equal(contract.successCriteria.length > 0, true);
});
