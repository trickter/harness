import { parseGoalContract, type GoalContract } from "../core/GoalContract.js";

export function createDailyWorkScenario(): GoalContract {
  return parseGoalContract({
    goal: {
      id: "daily-automation",
      name: "Daily Work Automation Tasks",
      objective: "Automate daily documentation updates, checklist checks, and reports generation.",
      expectedOutputs: ["reports/daily-summary.md"]
    },
    scope: {
      allowedArtifacts: ["docs/**", "reports/**", "src/**"],
      forbiddenArtifacts: [".env*", "secrets/**"],
      allowedOperations: ["fs:read", "fs:write", "shell:audit-docs"],
      forbiddenOperations: ["fs:delete", "network:*"]
    },
    successCriteria: ["Daily summary report is created.", "Stale documents are identified and audited."],
    verification: {
      commands: ["node scripts/audit-daily.mjs"],
      checks: ["document freshness audit"],
      qualityGates: ["Summary references all audited artifacts."]
    },
    stopConditions: {
      success: ["Summary report is successfully generated and verified."],
      fail: ["Checklist audit fails due to syntax or file access errors."]
    }
  });
}
