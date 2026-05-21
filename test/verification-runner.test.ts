import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ShellAdapter } from "../src/adapters/ShellAdapter.js";
import { parseGoalContract } from "../src/core/GoalContract.js";
import { LoopController } from "../src/core/LoopController.js";
import { PermissionPolicy } from "../src/core/PermissionPolicy.js";
import { JsonlRunLedger } from "../src/core/RunLedger.js";
import { VerificationRunner } from "../src/core/VerificationRunner.js";

async function createRunner(commands: string[]) {
  const directory = await mkdtemp(join(tmpdir(), "harness-verify-"));
  const ledger = new JsonlRunLedger(join(directory, "ledger.jsonl"));
  const contract = parseGoalContract({
    goal: {
      id: "verification-run",
      name: "Verification Run",
      objective: "Run configured verification commands."
    },
    scope: {
      allowedArtifacts: [],
      forbiddenArtifacts: [],
      allowedOperations: ["shell:verify"],
      forbiddenOperations: []
    },
    verification: {
      commands
    },
    budget: {
      maxIterations: 4,
      maxSameError: 2,
      maxNoProgress: 3,
      maxEscapeRounds: 1,
      maxChangedArtifacts: 4,
      maxRuntimeMinutes: 5
    }
  });
  const permissions = new PermissionPolicy(contract);
  const loop = new LoopController(contract, ledger, { permissions });

  return {
    directory,
    ledger,
    runner: new VerificationRunner(contract, loop, new ShellAdapter(permissions))
  };
}

test("verification runner records a finishing turn when all commands pass", async () => {
  const { directory, ledger, runner } = await createRunner(["node pass.cjs"]);
  await writeFile(join(directory, "pass.cjs"), "process.stdout.write('ok');", "utf8");

  const result = await runner.run({ cwd: directory });
  const entries = await ledger.readAll();

  assert.equal(result.verificationResult, "pass");
  assert.equal(result.turn.transition.to, "FINISH");
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.verificationResult, "pass");
  assert.equal(entries[0]?.nextPhase, "FINISH");
});

test("verification runner records a repair turn when a command fails", async () => {
  const { directory, ledger, runner } = await createRunner(["node fail.cjs"]);
  await writeFile(join(directory, "fail.cjs"), "process.stderr.write('bad'); process.exit(7);", "utf8");

  const result = await runner.run({ cwd: directory });
  const entries = await ledger.readAll();

  assert.equal(result.verificationResult, "fail");
  assert.equal(result.commands[0]?.exitCode, 7);
  assert.equal(result.turn.transition.to, "REPAIR");
  assert.equal(entries[0]?.verificationResult, "fail");
  assert.equal(entries[0]?.nextPhase, "REPAIR");
  assert.match(entries[0]?.errorSignature ?? "", /exit-7/);
});
