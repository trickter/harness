import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function cli(): string {
  return join(process.cwd(), "dist", "src", "cli", "index.js");
}

async function execAllowFailure(command: string, args: string[], cwd?: string) {
  try {
    return await execFileAsync(command, args, { cwd });
  } catch (error) {
    const failed = error as Error & { stdout: string; stderr: string; code: number };

    return {
      stdout: failed.stdout,
      stderr: failed.stderr
    };
  }
}

test("CLI recover reports and restores the latest healthy snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harness-recover-"));
  const repo = join(directory, "repo");
  const runDir = join(directory, "run");
  const contractPath = join(directory, "goal.yaml");

  await mkdir(join(repo, "src"), { recursive: true });
  await execFileAsync("git", ["init"], { cwd: repo });
  await writeFile(join(repo, "src", "app.ts"), "baseline\n", "utf8");
  await writeFile(
    join(repo, "verify.cjs"),
    "const fs = require('node:fs'); if (fs.readFileSync('src/app.ts', 'utf8') !== 'healthy\\n') process.exit(1);",
    "utf8"
  );
  await execFileAsync("git", ["add", "."], { cwd: repo });
  await execFileAsync(
    "git",
    ["-c", "user.name=Harness", "-c", "user.email=harness@example.com", "commit", "-m", "baseline"],
    { cwd: repo }
  );
  await writeFile(
    contractPath,
    `goal:
  id: recovery
  name: Recovery
  objective: Restore the last verified healthy point.
scope:
  allowedArtifacts:
    - src/**
  forbiddenArtifacts: []
  allowedOperations:
    - shell:verify
    - fs:write
  forbiddenOperations: []
verification:
  commands:
    - node verify.cjs
budget:
  maxIterations: 8
  maxSameError: 2
  maxNoProgress: 3
  maxEscapeRounds: 1
  maxChangedArtifacts: 4
  maxRuntimeMinutes: 5
`,
    "utf8"
  );
  await execFileAsync(process.execPath, [
    cli(),
    "start",
    "--contract",
    contractPath,
    "--run",
    runDir,
    "--cwd",
    repo
  ]);
  await writeFile(join(repo, "src", "app.ts"), "healthy\n", "utf8");

  const healthyVerify = JSON.parse(
    (await execFileAsync(process.execPath, [cli(), "verify", "--run", runDir, "--cwd", repo])).stdout
  ) as { healthySnapshot?: string };

  assert.equal(healthyVerify.healthySnapshot, "healthy");

  await writeFile(join(repo, "src", "app.ts"), "broken\n", "utf8");
  await writeFile(join(repo, "src", "bad.ts"), "export const bad = true;\n", "utf8");
  await execAllowFailure(process.execPath, [cli(), "verify", "--run", runDir, "--cwd", repo]);

  const report = JSON.parse(
    (await execFileAsync(process.execPath, [cli(), "recover", "--run", runDir, "--cwd", repo])).stdout
  ) as {
    recoveryPoint: string;
    baselineSnapshot: string;
    latestArtifacts: Array<{ path: string }>;
    keptArtifacts: Array<{ path: string }>;
    rollbackArtifacts: Array<{ path: string }>;
    failurePath: Array<{ verificationResult: string }>;
    restoredArtifacts: string[];
    reportPath: string;
  };

  assert.equal(report.baselineSnapshot, "baseline");
  assert.equal(report.recoveryPoint, "healthy");
  assert.deepEqual(
    report.latestArtifacts.map((artifact) => artifact.path),
    ["src/app.ts", "src/bad.ts"]
  );
  assert.deepEqual(report.keptArtifacts.map((artifact) => artifact.path), ["src/app.ts"]);
  assert.deepEqual(
    report.rollbackArtifacts.map((artifact) => artifact.path),
    ["src/app.ts", "src/bad.ts"]
  );
  assert.equal(report.failurePath.at(-1)?.verificationResult, "fail");
  assert.deepEqual(report.restoredArtifacts, []);
  assert.match(await readFile(report.reportPath, "utf8"), /src\/bad\.ts/);
  assert.equal(await readFile(join(repo, "src", "app.ts"), "utf8"), "broken\n");

  const recovered = JSON.parse(
    (await execFileAsync(process.execPath, [cli(), "recover", "--run", runDir, "--cwd", repo, "--apply"])).stdout
  ) as {
    restoredArtifacts: string[];
    scopeAudit: { allowed: boolean; changedArtifacts: Array<{ path: string }> };
  };

  assert.deepEqual(recovered.restoredArtifacts, ["src/app.ts", "src/bad.ts"]);
  assert.equal(recovered.scopeAudit.allowed, true);
  assert.deepEqual(recovered.scopeAudit.changedArtifacts.map((artifact) => artifact.path), ["src/app.ts"]);
  assert.equal(await readFile(join(repo, "src", "app.ts"), "utf8"), "healthy\n");
  await assert.rejects(readFile(join(repo, "src", "bad.ts"), "utf8"));
});
