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

export class BugFinderFixerAgent implements AutonomousWorker {
  readonly codex: CodexCliAdapter;
  readonly cwd: string;

  constructor(codex: CodexCliAdapter, cwd: string) {
    this.codex = codex;
    this.cwd = cwd;
  }

  async execute(action: AutonomousAction, context: HarnessContext): Promise<AutonomousWorkerResult> {
    const prompt = `You are the Bug Finder/Fixer Agent for a supervised autonomous harness run.
Your responsibility is to diagnose defects, formulate hypotheses, write reproduction tests, and implement targeted fixes.
Do not perform sweeping refactorings; keep changes minimal and precise.

Goal objective: ${context.contract.goal.objective}
Success criteria: ${JSON.stringify(context.contract.successCriteria)}
Allowed artifacts: ${JSON.stringify(context.contract.scope.allowedArtifacts)}
Forbidden artifacts: ${JSON.stringify(context.contract.scope.forbiddenArtifacts)}
Allowed operations: ${JSON.stringify(context.contract.scope.allowedOperations)}
Forbidden operations: ${JSON.stringify(context.contract.scope.forbiddenOperations)}

Supervised action:
${JSON.stringify(action, null, 2)}

Fix instruction:
${action.prompt}`;

    return this.codex.runStructured<AutonomousWorkerResult>({
      cwd: this.cwd,
      prompt,
      outputSchema: workerOutputSchema,
      sandbox: "workspace-write"
    });
  }
}
