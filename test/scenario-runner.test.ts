import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { BuiltinScenarioRunner } from "../src/scenarios/ScenarioRunner.js";

const execFileAsync = promisify(execFile);

function cli(): string {
  return join(process.cwd(), "dist", "src", "cli", "index.js");
}

test("refactor scenario runner scans validating tests and selects analysis daemons", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-refactor-scenario-"));

  await Promise.all([
    mkdir(join(root, "src", "auth"), { recursive: true }),
    mkdir(join(root, "test", "auth"), { recursive: true })
  ]);
  await writeFile(join(root, "src", "auth", "token.ts"), "export const token = true;\n", "utf8");
  await writeFile(
    join(root, "test", "auth", "token.test.ts"),
    'import { token } from "../../src/auth/token.js";\nvoid token;\n',
    "utf8"
  );

  const result = await new BuiltinScenarioRunner("refactor").run({
    cwd: root,
    paths: ["src/auth/token.ts", "test/auth/token.test.ts"]
  });

  assert.equal(result.verification.passed, true);
  assert.deepEqual(result.daemons, ["architecture-consistency-daemon", "test-coverage-daemon"]);
});

test("auto-modeling scenario runner verifies experiment lineage", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-modeling-scenario-"));

  await Promise.all([
    mkdir(join(root, "data"), { recursive: true }),
    mkdir(join(root, "experiments"), { recursive: true }),
    mkdir(join(root, "models"), { recursive: true })
  ]);
  await writeFile(join(root, "data", "train.csv"), "label,value\n1,2\n", "utf8");
  await writeFile(
    join(root, "experiments", "run.json"),
    '{ "dataset": "data/train.csv", "model": "models/baseline.onnx" }\n',
    "utf8"
  );
  await writeFile(join(root, "models", "baseline.onnx"), "model", "utf8");

  const result = await new BuiltinScenarioRunner("auto-modeling").run({
    cwd: root,
    paths: ["data/train.csv", "experiments/run.json", "models/baseline.onnx"]
  });

  assert.equal(result.verification.passed, true);
  assert.deepEqual(result.daemons, ["test-coverage-daemon"]);
});

test("daily-work scenario inspect CLI runs its task and summary verifier", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-daily-scenario-"));

  await Promise.all([
    mkdir(join(root, "tasks"), { recursive: true }),
    mkdir(join(root, "reports"), { recursive: true })
  ]);
  await writeFile(join(root, "tasks", "today.md"), "Review stale docs.\n", "utf8");
  await writeFile(join(root, "reports", "daily-summary.md"), "Summary.\n", "utf8");

  const output = JSON.parse(
    (
      await execFileAsync(process.execPath, [
        cli(),
        "scenario",
        "inspect",
        "--scenario",
        "daily-work",
        "--cwd",
        root,
        "--path",
        "tasks/today.md",
        "--path",
        "reports/daily-summary.md"
      ])
    ).stdout
  ) as { scenario: string; goalId: string; verification: { passed: boolean }; daemons: string[] };

  assert.equal(output.scenario, "daily-work");
  assert.equal(output.goalId, "daily-automation");
  assert.equal(output.verification.passed, true);
  assert.deepEqual(output.daemons, ["documentation-consistency-daemon", "test-coverage-daemon"]);
});
