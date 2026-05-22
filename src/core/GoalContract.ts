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

export const DEFAULT_SCOPE = {
  allowedArtifacts: [],
  forbiddenArtifacts: [".env*", "**/.env*", "secrets/**"],
  allowedOperations: ["fs:read"],
  forbiddenOperations: ["fs:delete", "git:push"]
};

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
    profile: z.enum(["sandbox", "workspace", "production"]).optional(),
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
      allowedArtifacts: stringList.default(DEFAULT_SCOPE.allowedArtifacts),
      forbiddenArtifacts: stringList.default(DEFAULT_SCOPE.forbiddenArtifacts),
      allowedOperations: stringList.default(DEFAULT_SCOPE.allowedOperations),
      forbiddenOperations: stringList.default(DEFAULT_SCOPE.forbiddenOperations)
    })
    .default(DEFAULT_SCOPE),
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
export type GoalContractGenerationInput = {
  name: string;
  objective: string;
  id?: string;
  background?: string;
};

type GoalIntent = "bugfix" | "code" | "data" | "documentation" | "general" | "model" | "refactor";

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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function hasAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function inferIntent(objective: string): GoalIntent {
  const normalized = objective.toLowerCase();

  if (
    hasAny(normalized, [
      /\bmodel\b/,
      /\bexperiment\b/,
      /\bmetric\b/,
      /\bbaseline\b/,
      /\btrain(?:ing)?\b/,
      /\bevaluat(?:e|ion)\b/,
      /模型/,
      /实验/,
      /指标/
    ])
  ) {
    return "model";
  }

  if (
    hasAny(normalized, [
      /\bdataset\b/,
      /\bdata quality\b/,
      /\bcsv\b/,
      /\bmissing values?\b/,
      /\bduplicates?\b/,
      /\boutliers?\b/,
      /数据/
    ])
  ) {
    return "data";
  }

  if (hasAny(normalized, [/\brefactor\b/, /\bmigrat(?:e|ion)\b/, /\brestructure\b/, /重构/, /迁移/])) {
    return "refactor";
  }

  if (hasAny(normalized, [/\bfix\b/, /\bbug\b/, /\bregression\b/, /\bfail(?:ure|ing)?\b/, /修复/, /错误/, /失败/])) {
    return "bugfix";
  }

  if (hasAny(normalized, [/\breadme\b/, /\bdocumentation\b/, /\bdocs?\b/, /\bquickstart\b/, /文档/, /说明/])) {
    return "documentation";
  }

  if (
    hasAny(normalized, [
      /\badd\b/,
      /\bapi\b/,
      /\bbuild\b/,
      /\bcli\b/,
      /\bfeature\b/,
      /\bimplement\b/,
      /\bmodule\b/,
      /\btest\b/,
      /新增/,
      /实现/,
      /功能/
    ])
  ) {
    return "code";
  }

  return "general";
}

function extractArtifactMentions(value: string): string[] {
  return unique(
    (value.match(/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.*-]+(?:\.[A-Za-z0-9_-]+)?/g) ?? [])
      .map((artifact) => artifact.replace(/[),.;:]+$/g, ""))
      .filter((artifact) => !artifact.includes("://"))
  );
}

function inferExpectedOutputs(intent: GoalIntent, artifacts: string[]): string[] {
  if (artifacts.length > 0) {
    return artifacts;
  }

  switch (intent) {
    case "bugfix":
      return ["bug fix changes", "regression verification"];
    case "code":
      return ["implementation changes", "focused verification coverage"];
    case "data":
      return ["data quality report", "reproducible data checks"];
    case "documentation":
      return ["documentation updates", "documentation verification evidence"];
    case "model":
      return ["experiment report", "model metrics evidence"];
    case "refactor":
      return ["refactored implementation", "compatibility verification"];
    default:
      return ["goal result artifacts", "verification evidence"];
  }
}

function inferAllowedArtifacts(intent: GoalIntent, artifacts: string[]): string[] {
  const defaults: Record<GoalIntent, string[]> = {
    bugfix: ["src/**", "test/**", "docs/**", "package.json"],
    code: ["src/**", "test/**", "docs/**", "package.json"],
    data: ["data/**", "reports/**", "scripts/**", "src/**", "test/**"],
    documentation: ["README*", "docs/**", "src/**", "test/**"],
    general: ["src/**", "test/**", "docs/**", "reports/**", "package.json"],
    model: ["data/**", "models/**", "reports/**", "scripts/**", "src/**", "test/**"],
    refactor: ["src/**", "test/**", "docs/**", "package.json"]
  };

  return unique([...artifacts, ...defaults[intent]]);
}

function inferAllowedOperations(intent: GoalIntent): string[] {
  const common = ["fs:read", "fs:write", "git:diff"];

  switch (intent) {
    case "data":
      return [...common, "shell:data-check"];
    case "documentation":
      return [...common, "shell:audit-docs"];
    case "model":
      return [...common, "shell:train", "shell:evaluate"];
    default:
      return [...common, "shell:test", "shell:typecheck"];
  }
}

function extractVerificationCommands(objective: string, intent: GoalIntent): string[] {
  const normalized = objective.toLowerCase();
  const explicitCommands = [...objective.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1]?.trim())
    .filter((command): command is string => Boolean(command))
    .filter((command) => /^(?:cargo|go|node|npm|npx|pnpm|pytest|python|uv|yarn)\b/.test(command));

  if (explicitCommands.length > 0) {
    return unique(explicitCommands);
  }

  if (hasAny(normalized, [/\bpytest\b/, /\bpython\b/, /\.py\b/])) {
    return ["pytest"];
  }

  if (hasAny(normalized, [/\bcargo\b/, /\brust\b/, /\.rs\b/])) {
    return ["cargo test"];
  }

  if (hasAny(normalized, [/\bgo test\b/, /\bgolang\b/, /\.go\b/])) {
    return ["go test ./..."];
  }

  if (
    intent === "code" ||
    intent === "bugfix" ||
    intent === "refactor" ||
    hasAny(normalized, [/\btypescript\b/, /\bjavascript\b/, /\bjest\b/, /\bvitest\b/, /\beslint\b/, /\.tsx?\b/, /\.jsx?\b/])
  ) {
    return ["npm test", "npm run check"];
  }

  return [];
}

function inferSuccessCriteria(intent: GoalIntent, objective: string): string[] {
  switch (intent) {
    case "bugfix":
      return [
        "The described failure no longer reproduces.",
        "Regression verification covers the fixed behavior.",
        "Relevant verification passes without scope drift."
      ];
    case "code":
      return [
        `Requested behavior is implemented: ${objective}`,
        "New or changed behavior has focused verification coverage.",
        "Relevant verification passes without scope drift."
      ];
    case "data":
      return [
        "Requested data checks are recorded with evidence.",
        "Data quality anomalies and limitations are reported.",
        "Declared data outputs can be reproduced from verification."
      ];
    case "documentation":
      return [
        `Documentation addresses the requested objective: ${objective}`,
        "Examples and commands stay consistent with referenced artifacts.",
        "Documentation changes are reviewable within declared scope."
      ];
    case "model":
      return [
        "Requested model or experiment result is recorded.",
        "Evaluation metrics and validation context are captured.",
        "Quality gates reject invalid or regressed experiment results."
      ];
    case "refactor":
      return [
        "Public behavior remains compatible after the refactor.",
        "Changed structure is covered by focused verification.",
        "Relevant tests and checks pass without dependency regressions."
      ];
    default:
      return [
        `Requested objective is satisfied: ${objective}`,
        "Expected outputs are identified and reviewable.",
        "Verification evidence supports completion."
      ];
  }
}

function inferVerification(intent: GoalIntent, objective: string): GoalContract["verification"] {
  const checks: Record<GoalIntent, string[]> = {
    bugfix: ["failure reproduction is closed", "regression coverage exists"],
    code: ["requested behavior is covered", "changed artifacts stay within scope"],
    data: ["missing, duplicate, and schema risks are evaluated", "limitations are documented"],
    documentation: ["documented commands and references are current", "stale guidance is removed"],
    general: ["expected outputs exist", "success criteria have evidence"],
    model: ["validation split and leakage risk are checked", "metrics are compared to the declared baseline"],
    refactor: ["public behavior compatibility is checked", "dependency direction regressions are reviewed"]
  };
  const qualityGates: Record<GoalIntent, string[]> = {
    bugfix: ["relevant verification passes", "the fixed failure does not recur"],
    code: ["relevant tests pass", "type or build checks pass when declared"],
    data: ["data checks cite produced evidence", "unknown data meaning is surfaced"],
    documentation: ["documentation matches current code and CLI behavior"],
    general: ["completion is supported by verification evidence"],
    model: ["metrics meet declared acceptance criteria", "invalid experiment results are rejected"],
    refactor: ["behavior is preserved", "verification coverage is maintained"]
  };

  return {
    commands: extractVerificationCommands(objective, intent),
    checks: checks[intent],
    qualityGates: qualityGates[intent]
  };
}

function inferRiskPolicy(objective: string): RiskPolicy {
  const normalized = objective.toLowerCase();
  const production = hasAny(normalized, [/\bdeploy\b/, /\bproduction\b/, /\brelease\b/, /\bpublish\b/, /生产/]);
  const sandbox = hasAny(normalized, [/\bsandbox\b/, /\bdisposable\b/, /沙盒/]);
  const destructive = hasAny(normalized, [/\bdelete\b/, /\bdestroy\b/, /\bdrop\b/, /\bremove\b/, /\brollback\b/, /删除/, /回滚/]);
  const secretAccess = hasAny(normalized, [/\bsecret\b/, /\btoken\b/, /\bcredential\b/, /\b\.env\b/, /密钥/, /凭据/]);

  return {
    profile: production ? "production" : sandbox ? "sandbox" : "workspace",
    destructiveActions: destructive ? "require_explicit_approval" : DEFAULT_RISK_POLICY.destructiveActions,
    externalNetwork: DEFAULT_RISK_POLICY.externalNetwork,
    secretAccess: secretAccess ? "restricted" : DEFAULT_RISK_POLICY.secretAccess
  };
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
      ...DEFAULT_SCOPE
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

export function createGoalContractFromNaturalLanguage(input: GoalContractGenerationInput): GoalContract {
  const intent = inferIntent(input.objective);
  const artifactMentions = extractArtifactMentions(input.objective);

  return parseGoalContract({
    goal: {
      id: input.id ?? slugify(input.name),
      name: input.name,
      objective: input.objective,
      background: input.background,
      expectedOutputs: inferExpectedOutputs(intent, artifactMentions)
    },
    scope: {
      allowedArtifacts: inferAllowedArtifacts(intent, artifactMentions),
      forbiddenArtifacts: DEFAULT_SCOPE.forbiddenArtifacts,
      allowedOperations: inferAllowedOperations(intent),
      forbiddenOperations: DEFAULT_SCOPE.forbiddenOperations
    },
    successCriteria: inferSuccessCriteria(intent, input.objective),
    verification: inferVerification(intent, input.objective),
    riskPolicy: inferRiskPolicy(input.objective),
    stopConditions: {
      success: ["All success criteria are satisfied and verification evidence is recorded."],
      fail: ["Permission denied without approval.", "Success criteria cannot be verified within declared scope."]
    }
  });
}
