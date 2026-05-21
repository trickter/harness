import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexCliAdapter } from "../src/adapters/CodexCliAdapter.js";
import { RefactorAgent } from "../src/agents/RefactorAgent.js";
import { BugFinderFixerAgent } from "../src/agents/BugFinderFixerAgent.js";
import { DataModelOptimizationAgent } from "../src/agents/DataModelOptimizationAgent.js";
import { architectureConsistencyDaemon, ArchitectureConsistencyDaemonRunner } from "../src/agents/ArchitectureConsistencyDaemon.js";
import { testCoverageDaemon, TestCoverageDaemonRunner } from "../src/agents/TestCoverageDaemon.js";
import { parseGoalContract } from "../src/core/GoalContract.js";
import { LoopController } from "../src/core/LoopController.js";
import { JsonlRunLedger } from "../src/core/RunLedger.js";

// A mock CodexCliAdapter for testing the worker agents
class MockCodexCliAdapter extends CodexCliAdapter {
  lastPrompt: string = "";
  
  constructor() {
    super({});
  }

  override async runStructured<T>(options: {
    cwd: string;
    prompt: string;
    outputSchema: Record<string, unknown>;
    sandbox: string;
  }): Promise<T> {
    this.lastPrompt = options.prompt;
    return {
      summary: "Mock execution result",
      changedArtifacts: ["src/somefile.ts"],
      commandsRun: ["npm test"],
      newInformation: ["Mock info"]
    } as unknown as T;
  }
}

async function createDaemonContext(objective: string) {
  const directory = await mkdtemp(join(tmpdir(), "harness-new-daemons-"));
  const ledger = new JsonlRunLedger(join(directory, "ledger.jsonl"));
  const contract = parseGoalContract({
    goal: { id: "test-daemon", name: "Test Daemon", objective }
  });
  const loop = new LoopController(contract, ledger);
  return { directory, ledger, loop };
}

test("RefactorAgent, BugFinderFixerAgent, and DataModelOptimizationAgent execute correctly", async () => {
  const mockCodex = new MockCodexCliAdapter();
  const contract = parseGoalContract({
    goal: { id: "refactor-goal", name: "Refactor Goal", objective: "Perform some task" }
  });
  const context = {
    contract,
    phase: "CONVERGE_EXECUTE",
    ledger: [],
    artifacts: {} as any,
    permissions: {} as any,
    runtime: { startedAt: "now", iteration: 1, escapeRounds: 0 }
  } as any;

  const action = {
    summary: "Perform refactoring",
    operation: "fs:write",
    artifacts: ["src/somefile.ts"],
    prompt: "refactor instruction"
  };

  // Refactor Agent
  const refactorAgent = new RefactorAgent(mockCodex, "cwd");
  const refactorRes = await refactorAgent.execute(action, context);
  assert.equal(refactorRes.summary, "Mock execution result");
  assert.match(mockCodex.lastPrompt, /Refactor Agent/);

  // Bug Finder Fixer Agent
  const bugAgent = new BugFinderFixerAgent(mockCodex, "cwd");
  const bugRes = await bugAgent.execute(action, context);
  assert.equal(bugRes.summary, "Mock execution result");
  assert.match(mockCodex.lastPrompt, /Bug Finder\/Fixer Agent/);

  // Data/Model Optimization Agent
  const optAgent = new DataModelOptimizationAgent(mockCodex, "cwd");
  const optRes = await optAgent.execute(action, context);
  assert.equal(optRes.summary, "Mock execution result");
  assert.match(mockCodex.lastPrompt, /Data\/Model Optimization Agent/);
});

test("architecture daemon detects layer violations", async () => {
  const { loop } = await createDaemonContext("Check architecture");
  const runner = new ArchitectureConsistencyDaemonRunner(architectureConsistencyDaemon, loop);

  // No violations
  const cleanResult = await runner.run({ changedArtifacts: ["src/core/StateMachine.ts"] });
  assert.equal(cleanResult.report.hasViolations, false);
  assert.equal(cleanResult.report.findings[0], "No architectural dependency or import violations detected.");

  // Violation
  const violationResult = await runner.run({ changedArtifacts: ["src/core/adapters-helper.ts"] });
  assert.equal(violationResult.report.hasViolations, true);
  assert.match(violationResult.report.findings[0] as string, /Potential layer violation/);
});

test("test coverage daemon detects coverage gaps", async () => {
  const { loop } = await createDaemonContext("Check coverage");
  const runner = new TestCoverageDaemonRunner(testCoverageDaemon, loop);

  // Source modified but no tests modified -> Gap
  const gapResult = await runner.run({ changedArtifacts: ["src/core/StateMachine.ts"] });
  assert.equal(gapResult.report.coverageGapDetected, true);
  assert.match(gapResult.report.findings[0] as string, /without test coverage updates/);

  // Both modified -> No gap
  const cleanResult = await runner.run({ changedArtifacts: ["src/core/StateMachine.ts", "test/state-machine.test.ts"] });
  assert.equal(cleanResult.report.coverageGapDetected, false);
  assert.equal(cleanResult.report.findings[0], "No coverage gaps detected from the changed artifacts.");
});
