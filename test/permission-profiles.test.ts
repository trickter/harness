import assert from "node:assert/strict";
import test from "node:test";
import { parseGoalContract } from "../src/core/GoalContract.js";
import { PermissionPolicy } from "../src/core/PermissionPolicy.js";

test("sandbox profile applies default restrictions", () => {
  const contract = parseGoalContract({
    goal: { id: "test", name: "Test", objective: "Test objective" },
    scope: { allowedArtifacts: ["src/**"], allowedOperations: ["fs:write"] },
    riskPolicy: { profile: "sandbox" }
  });
  const policy = new PermissionPolicy(contract);

  // Destructive should be allowed in sandbox
  const destructiveResult = policy.evaluate({ operation: "fs:write", artifacts: ["src/file.ts"], destructive: true });
  assert.equal(destructiveResult.allowed, true);

  // Network and secrets should be forbidden
  const networkResult = policy.evaluate({ operation: "fs:write", artifacts: ["src/file.ts"], externalNetwork: true });
  assert.equal(networkResult.allowed, false);
  assert.match(networkResult.reason, /external network access is forbidden/);

  const secretResult = policy.evaluate({ operation: "fs:write", artifacts: ["src/file.ts"], secretAccess: true });
  assert.equal(secretResult.allowed, false);
  assert.match(secretResult.reason, /secret access is forbidden/);
});

test("workspace profile applies default restrictions", () => {
  const contract = parseGoalContract({
    goal: { id: "test", name: "Test", objective: "Test objective" },
    scope: { allowedArtifacts: ["src/**"], allowedOperations: ["fs:write"] },
    riskPolicy: { profile: "workspace" }
  });
  const policy = new PermissionPolicy(contract);

  // Destructive require approval
  const destructiveDenied = policy.evaluate({ operation: "fs:write", artifacts: ["src/file.ts"], destructive: true });
  assert.equal(destructiveDenied.allowed, false);
  assert.equal(destructiveDenied.requiresHuman, true);

  // Network requires approval
  const networkDenied = policy.evaluate({ operation: "fs:write", artifacts: ["src/file.ts"], externalNetwork: true });
  assert.equal(networkDenied.allowed, false);
  assert.equal(networkDenied.requiresHuman, true);

  // Secret is forbidden
  const secretResult = policy.evaluate({ operation: "fs:write", artifacts: ["src/file.ts"], secretAccess: true });
  assert.equal(secretResult.allowed, false);
  assert.match(secretResult.reason, /secret access is forbidden/);
});

test("production profile applies default restrictions", () => {
  const contract = parseGoalContract({
    goal: { id: "test", name: "Test", objective: "Test objective" },
    scope: { allowedArtifacts: ["src/**"], allowedOperations: ["fs:write"] },
    riskPolicy: { profile: "production" }
  });
  const policy = new PermissionPolicy(contract);

  // Destructive is forbidden
  const destructiveDenied = policy.evaluate({ operation: "fs:write", artifacts: ["src/file.ts"], destructive: true });
  assert.equal(destructiveDenied.allowed, false);
  assert.match(destructiveDenied.reason, /destructive actions are forbidden/);

  // Network is forbidden
  const networkDenied = policy.evaluate({ operation: "fs:write", artifacts: ["src/file.ts"], externalNetwork: true });
  assert.equal(networkDenied.allowed, false);
  assert.match(networkDenied.reason, /external network access is forbidden/);

  // Secret is restricted (requires approval)
  const secretDenied = policy.evaluate({ operation: "fs:write", artifacts: ["src/file.ts"], secretAccess: true });
  assert.equal(secretDenied.allowed, false);
  assert.equal(secretDenied.requiresHuman, true);
});

test("profile baseline can be overridden explicitly", () => {
  const contract = parseGoalContract({
    goal: { id: "test", name: "Test", objective: "Test objective" },
    scope: { allowedArtifacts: ["src/**"], allowedOperations: ["fs:write"] },
    riskPolicy: {
      profile: "production",
      destructiveActions: "require_explicit_approval" // Override production's forbidden baseline
    }
  });
  const policy = new PermissionPolicy(contract);

  const destructiveResult = policy.evaluate({ operation: "fs:write", artifacts: ["src/file.ts"], destructive: true });
  assert.equal(destructiveResult.allowed, false);
  assert.equal(destructiveResult.requiresHuman, true); // Overridden to require explicit approval instead of forbidden
});
