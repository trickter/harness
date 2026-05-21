import { z } from "zod";
import { goalContractSchema } from "../core/GoalContract.js";
import { progressMetricsSchema } from "../core/ProgressEvaluator.js";
import { PHASES } from "../core/StateMachine.js";

const stringList = z.array(z.string());
const artifactEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  relation: z.string()
});

export const skillOutputSchemas = {
  "goal-contract-skill": goalContractSchema,
  "planning-skill": z.object({
    phase: z.literal("DIVERGE_PLAN"),
    assumptions: stringList,
    strategies: z.array(
      z.object({
        id: z.string(),
        summary: z.string(),
        risk: z.string()
      })
    ),
    selectedStrategyId: z.string(),
    nextAction: z.object({
      summary: z.string(),
      operation: z.string(),
      artifacts: stringList
    })
  }),
  "execution-skill": z.object({
    action: z.string(),
    operation: z.string(),
    changedArtifacts: stringList,
    commandsRun: stringList,
    newInformation: stringList,
    outcome: z.enum(["done", "blocked", "partial"])
  }),
  "verification-skill": z.object({
    result: z.enum(["pass", "fail", "partial", "skipped"]),
    commandsRun: stringList,
    checks: stringList,
    qualityGates: stringList,
    errorSignature: z.string().optional(),
    failureCount: z.number().int().nonnegative(),
    newInformation: stringList
  }),
  "progress-evaluator-skill": z.object({
    progressSignal: z.enum(["positive", "neutral", "negative"]),
    reason: z.string(),
    metrics: progressMetricsSchema.partial(),
    suggestedPhase: z.enum(PHASES)
  }),
  "escape-divergence-skill": z.object({
    failedPath: z.string(),
    hypotheses: z.array(z.string()).min(3),
    selectedStrategy: z.string()
  }),
  "supervisor-skill": z.object({
    phase: z.enum(PHASES),
    decision: z.enum(["continue", "repair", "escape", "finish", "need_human", "abort"]),
    action: z
      .object({
        summary: z.string(),
        operation: z.string(),
        artifacts: stringList
      })
      .optional(),
    reason: z.string()
  }),
  "daemon-agent-skill": z.object({
    daemon: z.object({
      name: z.string(),
      trigger: stringList,
      scope: stringList,
      maxRuntimeMinutes: z.number().positive(),
      maxActionsPerRun: z.number().int().positive(),
      outputMode: z.enum(["report_only", "suggest_patch", "auto_patch"]),
      stopConditions: stringList
    })
  }),
  "artifact-modeling-skill": z.object({
    artifacts: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        uri: z.string(),
        metadata: z.record(z.string(), z.unknown())
      })
    ),
    edges: z.array(artifactEdgeSchema)
  })
} as const;

export type SkillWithOutputSchema = keyof typeof skillOutputSchemas;

export function schemaForSkill(name: string): z.ZodType | undefined {
  return skillOutputSchemas[name as SkillWithOutputSchema];
}
