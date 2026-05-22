import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function cli(): string {
  return join(process.cwd(), "dist", "src", "cli", "index.js");
}

async function createContract(directory: string): Promise<string> {
  const contractPath = join(directory, "goal.yaml");

  await writeFile(
    contractPath,
    `goal:
  id: run-dir
  name: Run Dir
  objective: Manage a harness run directory.
scope:
  allowedArtifacts: []
  forbiddenArtifacts: []
  allowedOperations:
    - shell:verify
  forbiddenOperations: []
verification:
  commands:
    - node pass.cjs
budget:
  maxIterations: 4
  maxSameError: 2
  maxNoProgress: 3
  maxEscapeRounds: 1
  maxChangedArtifacts: 4
  maxRuntimeMinutes: 5
`,
    "utf8"
  );

  return contractPath;
}

test("run directory start, status, resume, turn, and verify use canonical paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harness-run-dir-"));
  const contractPath = await createContract(directory);
  const runDir = join(directory, ".harness", "runs", "run-dir");

  await execFileAsync("git", ["init"], { cwd: directory });
  await writeFile(join(directory, "pass.cjs"), "process.stdout.write('verification-pass');", "utf8");

  const start = JSON.parse(
    (
      await execFileAsync(process.execPath, [
        cli(),
        "start",
        "--contract",
        contractPath,
        "--run",
        runDir
      ])
    ).stdout
  ) as { phase: string; contract: string; ledger: string; status: string; baselineSnapshot: string };

  assert.equal(start.phase, "DIVERGE_PLAN");
  assert.equal(start.contract, join(runDir, "contract.yaml"));
  assert.equal(start.ledger, join(runDir, "ledger.jsonl"));
  assert.equal(start.baselineSnapshot, "baseline");

  const snapshot = JSON.parse(
    (await execFileAsync(process.execPath, [cli(), "snapshot", "--run", runDir, "--name", "latest", "--cwd", directory]))
      .stdout
  ) as { snapshot: string; path: string };

  assert.equal(snapshot.snapshot, "latest");
  assert.equal(snapshot.path, join(runDir, "snapshots", "latest.json"));

  const turn = JSON.parse(
    (
      await execFileAsync(process.execPath, [
        cli(),
        "turn",
        "--run",
        runDir,
        "--phase",
        "DIVERGE_PLAN",
        "--action",
        "Plan bounded verification.",
        "--verification",
        "skipped",
        "--info",
        "Plan is bounded.",
        "--selected-strategy-ready"
      ])
    ).stdout
  ) as { nextPhase: string; statusPath: string; turnDiff: string };

  assert.equal(turn.nextPhase, "CONVERGE_EXECUTE");
  assert.equal(turn.statusPath, join(runDir, "status.json"));
  assert.match(await readFile(turn.turnDiff, "utf8"), /Plan bounded verification/);

  const status = JSON.parse(
    (await execFileAsync(process.execPath, [cli(), "status", "--run", runDir])).stdout
  ) as { phase: string; entries: number };

  assert.equal(status.phase, "CONVERGE_EXECUTE");
  assert.equal(status.entries, 1);

  const resume = JSON.parse(
    (await execFileAsync(process.execPath, [cli(), "resume", "--run", runDir])).stdout
  ) as { recommendedNextStep: string; commands: string[] };

  assert.match(resume.recommendedNextStep, /Execute one bounded action/);
  assert.match(resume.commands[0] ?? "", /harness audit/);
  assert.match(resume.commands[1] ?? "", /harness turn/);

  const verify = JSON.parse(
    (await execFileAsync(process.execPath, [cli(), "verify", "--run", runDir, "--cwd", directory])).stdout
  ) as { verificationResult: string; nextPhase: string; statusPath: string; turnDiff: string };

  assert.equal(verify.verificationResult, "pass");
  assert.equal(verify.nextPhase, "FINISH");
  assert.equal(verify.statusPath, join(runDir, "status.json"));
  assert.match(await readFile(verify.turnDiff, "utf8"), /Run 1 verification command/);
  assert.equal(
    await readFile(join(runDir, "verification", "turn-0002", "command-001.stdout.log"), "utf8"),
    "verification-pass"
  );
  assert.match(await readFile(join(runDir, "verification", "turn-0002", "summary.json"), "utf8"), /pass/);
  assert.match(await readFile(join(runDir, "reports", "failure-timeline.json"), "utf8"), /Run 1 verification/);
  assert.match(await readFile(join(runDir, "reports", "final-summary.json"), "utf8"), /FINISH/);

  assert.match(await readFile(join(runDir, "status.json"), "utf8"), /FINISH/);
});

test("run snapshots and turn diffs redact forbidden artifact contents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harness-run-redact-"));
  const contractPath = join(directory, "goal.yaml");
  const runDir = join(directory, ".harness", "runs", "redact");

  await execFileAsync("git", ["init"], { cwd: directory });
  await writeFile(join(directory, ".env"), "TOKEN=secret\n", "utf8");
  await writeFile(
    contractPath,
    `goal:
  id: redact
  name: Redact
  objective: Redact forbidden artifacts.
scope:
  allowedArtifacts:
    - "**"
  allowedOperations:
    - fs:read
verification:
  commands: []
`,
    "utf8"
  );

  await execFileAsync(process.execPath, [cli(), "start", "--contract", contractPath, "--run", runDir, "--cwd", directory]);

  const baseline = JSON.parse(await readFile(join(runDir, "snapshots", "baseline.json"), "utf8")) as {
    workspaceArtifacts: Array<{ path: string; redacted?: boolean; contentBase64?: string }>;
  };
  const envSnapshot = baseline.workspaceArtifacts.find((artifact) => artifact.path === ".env");

  assert.equal(envSnapshot?.redacted, true);
  assert.equal(envSnapshot?.contentBase64, undefined);

  const turn = JSON.parse(
    (
      await execFileAsync(process.execPath, [
        cli(),
        "turn",
        "--run",
        runDir,
        "--cwd",
        directory,
        "--phase",
        "DIVERGE_PLAN",
        "--action",
        "Plan redaction.",
        "--verification",
        "skipped",
        "--selected-strategy-ready"
      ])
    ).stdout
  ) as { turnDiff: string };
  const diff = JSON.parse(await readFile(turn.turnDiff, "utf8")) as {
    redactedArtifacts: string[];
    workingTreeDiff: { error?: string; output?: string };
  };

  assert.deepEqual(diff.redactedArtifacts, [".env"]);
  assert.match(diff.workingTreeDiff.error ?? "", /redacted/);
  assert.equal(diff.workingTreeDiff.output, undefined);
});
