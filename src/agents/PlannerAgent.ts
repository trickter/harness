import type { CodexCliAdapter } from "../adapters/CodexCliAdapter.js";
import type { HarnessContext } from "../core/LoopController.js";
import type { AutonomousPlan, AutonomousPlanner } from "./AutonomousTypes.js";

const plannerOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["strategy", "currentHypothesis", "action", "newInformation"],
  properties: {
    strategy: { type: "string" },
    currentHypothesis: { type: "string" },
    action: {
      type: "object",
      additionalProperties: false,
      required: [
        "summary",
        "operation",
        "artifacts",
        "prompt",
        "destructive",
        "externalNetwork",
        "secretAccess"
      ],
      properties: {
        summary: { type: "string" },
        operation: { type: "string" },
        artifacts: { type: "array", items: { type: "string" } },
        prompt: { type: "string" },
        destructive: { type: "boolean" },
        externalNetwork: { type: "boolean" },
        secretAccess: { type: "boolean" }
      }
    },
    newInformation: { type: "array", items: { type: "string" } }
  }
};

function contextSnapshot(context: HarnessContext): string {
  return JSON.stringify(
    {
      phase: context.phase,
      goal: context.contract.goal,
      scope: context.contract.scope,
      successCriteria: context.contract.successCriteria,
      verification: context.contract.verification,
      budget: context.contract.budget,
      recentLedger: context.ledger.slice(-6).map((entry) => ({
        phase: entry.phase,
        action: entry.action,
        verificationResult: entry.verificationResult,
        errorSignature: entry.errorSignature,
        nextPhase: entry.nextPhase,
        newInformation: entry.newInformation
      }))
    },
    null,
    2
  );
}

export class CodexPlannerAgent implements AutonomousPlanner {
  readonly codex: CodexCliAdapter;
  readonly cwd: string;

  constructor(codex: CodexCliAdapter, cwd: string) {
    this.codex = codex;
    this.cwd = cwd;
  }

  async plan(context: HarnessContext): Promise<AutonomousPlan> {
    const prompt = `You are the Planner Agent for a supervised autonomous harness run.
Return one bounded next action only. Do not edit files.
Choose action.operation from the Goal Contract allowedOperations and keep action.artifacts inside allowedArtifacts.
For REPAIR, act on the latest verification failure. For ESCAPE_DIVERGE, choose a materially different path.
The Worker Agent receives action.prompt and may do only that bounded action.

Harness context:
${contextSnapshot(context)}`;

    return this.codex.runStructured<AutonomousPlan>({
      cwd: this.cwd,
      prompt,
      outputSchema: plannerOutputSchema,
      sandbox: "read-only"
    });
  }
}
