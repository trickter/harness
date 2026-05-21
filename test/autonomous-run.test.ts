import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ShellAdapter } from "../src/adapters/ShellAdapter.js";
import type {
  AutonomousAction,
  AutonomousPlan,
  AutonomousPlanner,
  AutonomousWorker,
  AutonomousWorkerResult
} from "../src/agents/AutonomousTypes.js";
import { ContractSupervisorAgent } from "../src/agents/SupervisorAgent.js";
import { ContractVerifierAgent } from "../src/agents/VerifierAgent.js";
import { AutonomousRun } from "../src/core/AutonomousRun.js";
import { parseGoalContract } from "../src/core/GoalContract.js";
import type { HarnessContext } from "../src/core/LoopController.js";
import { LoopController } from "../src/core/LoopController.js";
import { PermissionPolicy } from "../src/core/PermissionPolicy.js";
import { JsonlRunLedger } from "../src/core/RunLedger.js";
import { VerificationRunner } from "../src/core/VerificationRunner.js";

class RepairingPlanner implements AutonomousPlanner {
  readonly phases: string[] = [];

  async plan(context: HarnessContext): Promise<AutonomousPlan> {
    this.phases.push(context.phase);
    const repair = context.phase === "REPAIR";

    return {
      strategy: repair ? "Repair the failed output." : "Create the output artifact.",
      currentHypothesis: repair ? "Verification failed because content is wrong." : "The output is missing.",
      action: {
        summary: repair ? "Write the verified content." : "Write the initial content.",
        operation: "fs:write",
        artifacts: ["result.txt"],
        prompt: repair ? "write-correct" : "write-wrong"
      },
      newInformation: [repair ? "Use the verification failure." : "Start with one output file."]
    };
  }
}

class FileWritingWorker implements AutonomousWorker {
  readonly cwd: string;
  readonly actions: AutonomousAction[] = [];

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async execute(action: AutonomousAction): Promise<AutonomousWorkerResult> {
    this.actions.push(action);
    const content = action.prompt === "write-correct" ? "correct" : "wrong";

    await writeFile(join(this.cwd, "result.txt"), content, "utf8");

    return {
      summary: `Wrote ${content} content.`,
      changedArtifacts: ["result.txt"],
      commandsRun: [],
      newInformation: [`result.txt now contains ${content}.`]
    };
  }
}

test("autonomous run plans, executes, verifies, repairs, and finishes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harness-autonomous-"));
  const ledger = new JsonlRunLedger(join(directory, "ledger.jsonl"));
  await writeFile(
    join(directory, "verify.cjs"),
    "const fs = require('node:fs'); if (fs.readFileSync('result.txt', 'utf8') !== 'correct') { console.error('Error: wrong content'); process.exit(1); }",
    "utf8"
  );
  const contract = parseGoalContract({
    goal: {
      id: "autonomous-repair",
      name: "Autonomous Repair",
      objective: "Create verified content."
    },
    scope: {
      allowedArtifacts: ["result.txt"],
      forbiddenArtifacts: [],
      allowedOperations: ["fs:write", "shell:verify"],
      forbiddenOperations: []
    },
    successCriteria: ["The verification command passes."],
    verification: {
      commands: ["node verify.cjs"]
    },
    budget: {
      maxIterations: 8,
      maxSameError: 2,
      maxNoProgress: 3,
      maxEscapeRounds: 1,
      maxChangedArtifacts: 2,
      maxRuntimeMinutes: 5
    }
  });
  const permissions = new PermissionPolicy(contract);
  const loop = new LoopController(contract, ledger, { permissions });
  const planner = new RepairingPlanner();
  const worker = new FileWritingWorker(directory);
  const verifier = new ContractVerifierAgent(new VerificationRunner(contract, loop, new ShellAdapter(permissions)));
  const result = await new AutonomousRun(
    contract,
    loop,
    planner,
    new ContractSupervisorAgent(),
    worker,
    verifier
  ).run({ cwd: directory });
  const entries = await ledger.readAll();

  assert.equal(result.phase, "FINISH");
  assert.deepEqual(planner.phases, ["DIVERGE_PLAN", "REPAIR"]);
  assert.equal(worker.actions.length, 2);
  assert.equal(await readFile(join(directory, "result.txt"), "utf8"), "correct");
  assert.deepEqual(
    entries.map((entry) => entry.phase),
    ["DIVERGE_PLAN", "CONVERGE_EXECUTE", "VERIFY", "REPAIR", "VERIFY"]
  );
  assert.deepEqual(
    entries.map((entry) => entry.nextPhase),
    ["CONVERGE_EXECUTE", "VERIFY", "REPAIR", "VERIFY", "FINISH"]
  );
});
