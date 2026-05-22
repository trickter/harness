import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AutonomousAction, AutonomousWorker, AutonomousWorkerResult } from "../src/agents/AutonomousTypes.js";
import { ScenarioAgentOrchestrator } from "../src/agents/ScenarioAgentOrchestrator.js";
import { ArtifactGraph } from "../src/artifacts/ArtifactGraph.js";
import { parseGoalContract } from "../src/core/GoalContract.js";
import type { HarnessContext } from "../src/core/LoopController.js";
import { LoopController } from "../src/core/LoopController.js";
import { JsonlRunLedger } from "../src/core/RunLedger.js";
import type { Phase } from "../src/core/StateMachine.js";

class RecordingWorker implements AutonomousWorker {
  readonly name: string;
  readonly actions: AutonomousAction[] = [];

  constructor(name: string) {
    this.name = name;
  }

  async execute(action: AutonomousAction): Promise<AutonomousWorkerResult> {
    this.actions.push(action);

    return {
      summary: `${this.name} handled ${action.summary}`,
      changedArtifacts: action.artifacts,
      commandsRun: [],
      newInformation: [this.name]
    };
  }
}

function action(summary: string, operation: string, artifact: string): AutonomousAction {
  return {
    summary,
    operation,
    artifacts: [artifact],
    prompt: summary
  };
}

async function contextFor(objective: string, phase: Phase): Promise<HarnessContext> {
  const directory = await mkdtemp(join(tmpdir(), "harness-orchestrator-"));
  const contract = parseGoalContract({
    goal: {
      id: "orchestrator",
      name: "Orchestrator",
      objective
    },
    scope: {
      allowedArtifacts: ["src/**", "test/**", "models/**"],
      forbiddenArtifacts: [],
      allowedOperations: ["fs:write", "shell:test", "shell:train", "shell:evaluate"],
      forbiddenOperations: []
    }
  });
  const loop = new LoopController(contract, new JsonlRunLedger(join(directory, "ledger.jsonl")));

  return {
    contract,
    phase,
    ledger: [],
    artifacts: new ArtifactGraph(),
    permissions: loop.permissions,
    runtime: loop.runtime
  };
}

test("scenario agent orchestrator selects refactor work and switches repair to bug fixing", async () => {
  const defaultWorker = new RecordingWorker("default");
  const refactorWorker = new RecordingWorker("refactor");
  const bugWorker = new RecordingWorker("bug");
  const orchestrator = new ScenarioAgentOrchestrator({
    defaultWorker,
    refactorWorker,
    bugFinderFixerWorker: bugWorker
  });

  await orchestrator.execute(action("Move legacy module behind the new interface.", "fs:write", "src/session.ts"), await contextFor("Refactor the session module.", "CONVERGE_EXECUTE"));
  await orchestrator.execute(action("Repair the verification failure.", "fs:write", "src/session.ts"), await contextFor("Refactor the session module.", "REPAIR"));

  assert.equal(refactorWorker.actions.length, 1);
  assert.equal(bugWorker.actions.length, 1);
  assert.deepEqual(
    orchestrator.routes.map((route) => route.kind),
    ["refactor", "bug-finder-fixer"]
  );
});

test("scenario agent orchestrator routes model work and protects parallel artifact ownership", async () => {
  const defaultWorker = new RecordingWorker("default");
  const modelWorker = new RecordingWorker("model");
  const orchestrator = new ScenarioAgentOrchestrator({
    defaultWorker,
    dataModelOptimizationWorker: modelWorker
  });
  const modelContext = await contextFor("Train a baseline model and compare validation metrics.", "CONVERGE_EXECUTE");
  const genericContext = await contextFor("Create bounded implementation artifacts.", "CONVERGE_EXECUTE");

  await orchestrator.execute(action("Record validation metrics.", "shell:evaluate", "models/metrics.json"), modelContext);
  const parallel = await orchestrator.executeParallel(
    [
      action("Write implementation.", "fs:write", "src/feature.ts"),
      action("Write tests.", "fs:write", "test/feature.test.ts")
    ],
    genericContext
  );

  assert.equal(modelWorker.actions.length, 1);
  assert.equal(defaultWorker.actions.length, 2);
  assert.equal(parallel.length, 2);
  await assert.rejects(
    orchestrator.executeParallel(
      [
        action("Write first patch.", "fs:write", "src/shared.ts"),
        action("Write second patch.", "fs:write", "src/shared.ts")
      ],
      genericContext
    ),
    /parallel agent actions overlap artifacts/
  );
});
