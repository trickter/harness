import type { CodexCliAdapter } from "../adapters/CodexCliAdapter.js";
import type { HarnessContext } from "../core/LoopController.js";
import type { AutonomousAction, AutonomousWorker, AutonomousWorkerResult } from "./AutonomousTypes.js";

const workerOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "changedArtifacts", "commandsRun", "newInformation"],
  properties: {
    summary: { type: "string" },
    changedArtifacts: { type: "array", items: { type: "string" } },
    commandsRun: { type: "array", items: { type: "string" } },
    newInformation: { type: "array", items: { type: "string" } }
  }
};

export class CodexWorkerAgent implements AutonomousWorker {
  readonly codex: CodexCliAdapter;
  readonly cwd: string;

  constructor(codex: CodexCliAdapter, cwd: string) {
    this.codex = codex;
    this.cwd = cwd;
  }

  async execute(action: AutonomousAction, context: HarnessContext): Promise<AutonomousWorkerResult> {
    const prompt = `You are the Worker Agent for a supervised autonomous harness run.
Execute exactly one bounded action. Do not decide whether the goal is complete.
Do not broaden the listed operation or artifact scope. Do not run Goal Contract verification commands unless the action asks for them.

Goal objective: ${context.contract.goal.objective}
Success criteria: ${JSON.stringify(context.contract.successCriteria)}
Allowed artifacts: ${JSON.stringify(context.contract.scope.allowedArtifacts)}
Forbidden artifacts: ${JSON.stringify(context.contract.scope.forbiddenArtifacts)}
Allowed operations: ${JSON.stringify(context.contract.scope.allowedOperations)}
Forbidden operations: ${JSON.stringify(context.contract.scope.forbiddenOperations)}

Supervised action:
${JSON.stringify(action, null, 2)}

Worker instruction:
${action.prompt}`;

    return this.codex.runStructured<AutonomousWorkerResult>({
      cwd: this.cwd,
      prompt,
      outputSchema: workerOutputSchema,
      sandbox: "workspace-write"
    });
  }
}
