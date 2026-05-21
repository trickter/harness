import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const DEFAULT_BUDGET = {
  maxIterations: 12,
  maxSameError: 2,
  maxNoProgress: 3,
  maxEscapeRounds: 2,
  maxChangedArtifacts: 12,
  maxRuntimeMinutes: 30
} as const;

export const DEFAULT_RISK_POLICY = {
  destructiveActions: "forbidden",
  externalNetwork: "restricted",
  secretAccess: "forbidden"
} as const;

const nonEmptyString = z.string().trim().min(1);
const stringList = z.array(nonEmptyString).default([]);

const budgetSchema = z
  .object({
    maxIterations: z.number().int().positive().default(DEFAULT_BUDGET.maxIterations),
    maxSameError: z.number().int().positive().default(DEFAULT_BUDGET.maxSameError),
    maxNoProgress: z.number().int().positive().default(DEFAULT_BUDGET.maxNoProgress),
    maxEscapeRounds: z.number().int().nonnegative().default(DEFAULT_BUDGET.maxEscapeRounds),
    maxChangedArtifacts: z.number().int().positive().default(DEFAULT_BUDGET.maxChangedArtifacts),
    maxRuntimeMinutes: z.number().positive().default(DEFAULT_BUDGET.maxRuntimeMinutes)
  })
  .default(DEFAULT_BUDGET);

export const riskPolicySchema = z
  .object({
    destructiveActions: z
      .enum(["forbidden", "require_explicit_approval", "allowed_in_sandbox"])
      .default(DEFAULT_RISK_POLICY.destructiveActions),
    externalNetwork: z
      .enum(["forbidden", "restricted", "allowed"])
      .default(DEFAULT_RISK_POLICY.externalNetwork),
    secretAccess: z.enum(["forbidden", "restricted"]).default(DEFAULT_RISK_POLICY.secretAccess)
  })
  .default(DEFAULT_RISK_POLICY);

export const goalContractSchema = z.object({
  goal: z.object({
    id: nonEmptyString,
    name: nonEmptyString,
    objective: nonEmptyString,
    background: z.string().trim().optional(),
    expectedOutputs: stringList
  }),
  scope: z
    .object({
      allowedArtifacts: stringList,
      forbiddenArtifacts: stringList,
      allowedOperations: stringList,
      forbiddenOperations: stringList
    })
    .default({
      allowedArtifacts: [],
      forbiddenArtifacts: [".env*", "**/.env*", "secrets/**"],
      allowedOperations: ["fs:read"],
      forbiddenOperations: ["fs:delete", "git:push"]
    }),
  successCriteria: stringList,
  verification: z
    .object({
      commands: stringList,
      checks: stringList,
      qualityGates: stringList
    })
    .default({ commands: [], checks: [], qualityGates: [] }),
  budget: budgetSchema,
  riskPolicy: riskPolicySchema,
  stopConditions: z
    .object({
      success: stringList,
      fail: stringList
    })
    .default({ success: [], fail: [] })
});

export type GoalContract = z.infer<typeof goalContractSchema>;
export type RiskPolicy = GoalContract["riskPolicy"];

const contractKeyMap = {
  expected_outputs: "expectedOutputs",
  allowed_artifacts: "allowedArtifacts",
  forbidden_artifacts: "forbiddenArtifacts",
  allowed_operations: "allowedOperations",
  forbidden_operations: "forbiddenOperations",
  success_criteria: "successCriteria",
  quality_gates: "qualityGates",
  max_iterations: "maxIterations",
  max_same_error: "maxSameError",
  max_no_progress: "maxNoProgress",
  max_escape_rounds: "maxEscapeRounds",
  max_changed_artifacts: "maxChangedArtifacts",
  max_runtime_minutes: "maxRuntimeMinutes",
  risk_policy: "riskPolicy",
  destructive_actions: "destructiveActions",
  external_network: "externalNetwork",
  secret_access: "secretAccess",
  stop_conditions: "stopConditions"
} as const;

type ContractKey = keyof typeof contractKeyMap;

function normalizeContractKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeContractKeys);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      contractKeyMap[key as ContractKey] ?? key,
      normalizeContractKeys(entry)
    ])
  );
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "goal";
}

export function parseGoalContract(input: unknown): GoalContract {
  return goalContractSchema.parse(normalizeContractKeys(input));
}

export function parseGoalContractText(text: string): GoalContract {
  return parseGoalContract(parseYaml(text));
}

export async function loadGoalContract(path: string): Promise<GoalContract> {
  return parseGoalContractText(await readFile(path, "utf8"));
}

export function createGoalContractTemplate(input: {
  name: string;
  objective: string;
  id?: string;
}): GoalContract {
  return parseGoalContract({
    goal: {
      id: input.id ?? slugify(input.name),
      name: input.name,
      objective: input.objective,
      expectedOutputs: []
    },
    scope: {
      allowedArtifacts: [],
      forbiddenArtifacts: [".env*", "**/.env*", "secrets/**"],
      allowedOperations: ["fs:read"],
      forbiddenOperations: ["fs:delete", "git:push"]
    },
    successCriteria: [],
    verification: {
      commands: [],
      checks: [],
      qualityGates: []
    },
    stopConditions: {
      success: [],
      fail: ["permission denied without approval"]
    }
  });
}
