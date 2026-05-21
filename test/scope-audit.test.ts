import assert from "node:assert/strict";
import test from "node:test";
import { parseGoalContract } from "../src/core/GoalContract.js";
import { auditChangedArtifacts, parseGitStatusPorcelain } from "../src/core/ScopeAudit.js";

test("parseGitStatusPorcelain extracts changed paths and rename targets", () => {
  assert.deepEqual(parseGitStatusPorcelain(" M src/app.ts\n?? docs/new.md\nR  old.ts -> src/new.ts\n"), [
    { path: "src/app.ts", status: "M" },
    { path: "docs/new.md", status: "??" },
    { path: "src/new.ts", status: "R" }
  ]);
});

test("auditChangedArtifacts flags forbidden and out-of-scope changes", () => {
  const contract = parseGoalContract({
    goal: {
      id: "scope",
      name: "Scope",
      objective: "Audit scope."
    },
    scope: {
      allowedArtifacts: ["src/**"],
      forbiddenArtifacts: ["secrets/**"],
      allowedOperations: ["fs:write"],
      forbiddenOperations: []
    },
    budget: {
      maxIterations: 4,
      maxSameError: 2,
      maxNoProgress: 3,
      maxEscapeRounds: 1,
      maxChangedArtifacts: 2,
      maxRuntimeMinutes: 5
    }
  });
  const audit = auditChangedArtifacts({
    contract,
    cwd: "/repo",
    changedArtifacts: [
      { path: "src/app.ts", status: "M" },
      { path: "docs/readme.md", status: "M" },
      { path: "secrets/key.txt", status: "??" }
    ]
  });

  assert.equal(audit.allowed, false);
  assert.deepEqual(audit.allowedArtifacts, ["src/app.ts"]);
  assert.deepEqual(audit.outOfScopeArtifacts, ["docs/readme.md", "secrets/key.txt"]);
  assert.deepEqual(audit.forbiddenMatches, ["secrets/key.txt"]);
  assert.equal(audit.exceedsChangedArtifactBudget, true);
  assert.equal(audit.recommendation, "need_human");
});
