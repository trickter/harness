import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseGoalContract } from "../src/core/GoalContract.js";
import { LoopController } from "../src/core/LoopController.js";
import { JsonlRunLedger } from "../src/core/RunLedger.js";

const contract = parseGoalContract({
  goal: {
    id: "loop",
    name: "Loop",
    objective: "Exercise a supervised loop."
  },
  scope: {
    allowedArtifacts: ["src/**"],
    forbiddenArtifacts: [],
    allowedOperations: ["fs:read"],
    forbiddenOperations: []
  },
  budget: {
    maxIterations: 8,
    maxSameError: 2,
    maxNoProgress: 3,
    maxEscapeRounds: 2,
    maxChangedArtifacts: 4,
    maxRuntimeMinutes: 5
  }
});

test("loop controller appends ledger turns and advances plan, execute, verify", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harness-ledger-"));
  const ledger = new JsonlRunLedger(join(directory, "run.jsonl"));
  const loop = new LoopController(contract, ledger);

  const plan = await loop.recordTurn({
    action: "Select bounded strategy.",
    changedArtifacts: [],
    commandsRun: [],
    verificationResult: "skipped",
    newInformation: ["Strategy narrowed to source inspection."],
    selectedStrategyReady: true
  });
  const execute = await loop.recordTurn({
    action: "Inspect target source.",
    changedArtifacts: [],
    commandsRun: [],
    verificationResult: "skipped",
    newInformation: ["The source file has no guard."],
    actionCompleted: true
  });
  const verify = await loop.recordTurn({
    action: "Run focused verification.",
    changedArtifacts: [],
    commandsRun: ["npm test -- focused"],
    verificationResult: "fail",
    errorSignature: "focused:test:missing-guard",
    newInformation: ["The focused test captures the missing guard."],
    failureCountDelta: 1
  });

  assert.equal(plan.transition.to, "CONVERGE_EXECUTE");
  assert.equal(execute.transition.to, "VERIFY");
  assert.equal(verify.transition.to, "REPAIR");
  assert.equal((await ledger.readAll()).length, 3);
});

test("loop controller allows the last iteration budgeted turn to finish", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harness-ledger-"));
  const ledger = new JsonlRunLedger(join(directory, "run.jsonl"));
  const finalIterationContract = parseGoalContract({
    goal: {
      id: "final-iteration",
      name: "Final Iteration",
      objective: "Finish on the last budgeted turn."
    },
    scope: {
      allowedArtifacts: ["src/**"],
      forbiddenArtifacts: [],
      allowedOperations: ["fs:read"],
      forbiddenOperations: []
    },
    budget: {
      maxIterations: 1,
      maxSameError: 2,
      maxNoProgress: 3,
      maxEscapeRounds: 1,
      maxChangedArtifacts: 4,
      maxRuntimeMinutes: 5
    }
  });
  const loop = new LoopController(finalIterationContract, ledger);
  const finalTurn = await loop.recordTurn({
    phase: "VERIFY",
    action: "Verify final result.",
    changedArtifacts: [],
    commandsRun: ["npm test"],
    verificationResult: "pass",
    newInformation: [],
    objectiveDelta: 1,
    successCriteriaMet: true
  });

  assert.equal(finalTurn.stopDecision.stop, false);
  assert.equal(finalTurn.transition.to, "FINISH");
});
