import { parseGoalContract, type GoalContract } from "../core/GoalContract.js";

export function createAutoModelingScenario(): GoalContract {
  return parseGoalContract({
    goal: {
      id: "dataset-auto-modeling",
      name: "Dataset Auto Modeling Pipeline",
      objective: "Build, evaluate, and establish a baseline and model validation pipeline for a given dataset.",
      expectedOutputs: ["models/baseline.json", "reports/experiment-log.md"]
    },
    scope: {
      allowedArtifacts: ["data/**", "models/**", "reports/**", "src/**"],
      forbiddenArtifacts: [".env*", "secrets/**"],
      allowedOperations: ["fs:read", "fs:write", "shell:train", "shell:evaluate"],
      forbiddenOperations: ["fs:delete", "network:*"]
    },
    successCriteria: ["Model baseline is established.", "Evaluation metrics are recorded on validation sets.", "No data leakage is detected."],
    verification: {
      commands: ["node scripts/evaluate-pipeline.mjs"],
      checks: ["baseline established", "metrics validated", "data split validation"],
      qualityGates: ["Validation accuracy meets minimum threshold."]
    },
    stopConditions: {
      success: ["Evaluation and logs are fully documented."],
      fail: ["No performance improvement over random baseline."]
    }
  });
}
