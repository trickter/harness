import assert from "node:assert/strict";
import test from "node:test";
import { parseGoalContract } from "../src/core/GoalContract.js";
import { PermissionPolicy } from "../src/core/PermissionPolicy.js";

const contract = parseGoalContract({
  goal: {
    id: "write-source",
    name: "Write Source",
    objective: "Change a source file."
  },
  scope: {
    allowedArtifacts: ["src/**"],
    forbiddenArtifacts: [".env*", "secrets/**"],
    allowedOperations: ["fs:write"],
    forbiddenOperations: ["fs:delete"]
  },
  riskPolicy: {
    destructiveActions: "require_explicit_approval",
    externalNetwork: "forbidden",
    secretAccess: "restricted"
  }
});

test("permission policy rejects out-of-scope and forbidden network actions", () => {
  const decision = new PermissionPolicy(contract).evaluate({
    operation: "fs:write",
    artifacts: ["docs/readme.md"],
    externalNetwork: true
  });

  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /not explicitly allowed/);
  assert.match(decision.reason, /external network access is forbidden/);
});

test("permission policy marks restricted risk that needs human approval", () => {
  const decision = new PermissionPolicy(contract).evaluate({
    operation: "fs:write",
    artifacts: ["src/auth.ts"],
    destructive: true,
    secretAccess: true
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.requiresHuman, true);
  assert.match(decision.reason, /explicit approval/);
});
