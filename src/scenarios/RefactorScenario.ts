import { parseGoalContract, type GoalContract } from "../core/GoalContract.js";

export function createRefactorScenario(): GoalContract {
  return parseGoalContract({
    goal: {
      id: "module-refactor",
      name: "Module Refactoring and Migration",
      objective: "Refactor a legacy module to modern standards while maintaining backwards compatibility and verification.",
      expectedOutputs: ["src/refactored/**", "test/refactored/**"]
    },
    scope: {
      allowedArtifacts: ["src/**", "test/**", "package.json"],
      forbiddenArtifacts: [".env*", "secrets/**"],
      allowedOperations: ["fs:read", "fs:write", "shell:test", "shell:typecheck", "git:diff"],
      forbiddenOperations: ["fs:delete", "git:push"]
    },
    successCriteria: ["Existing test suite passes.", "Refactored module exports match legacy interface.", "No architectural dependency directions are violated."],
    verification: {
      commands: ["npm test", "npm run check"],
      checks: ["backward compatibility check", "dependency direction audit"],
      qualityGates: ["Coverage is maintained or improved."]
    },
    stopConditions: {
      success: ["All verification checks pass."],
      fail: ["Refactoring causes regression in unrelated modules."]
    }
  });
}
