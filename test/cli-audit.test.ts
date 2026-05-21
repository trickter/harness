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

test("CLI diff and audit inspect real git changes against contract scope", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harness-audit-"));
  const repo = join(directory, "repo");
  const runDir = join(directory, "run");
  const contractPath = join(directory, "goal.yaml");

  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(join(repo, "secrets"), { recursive: true });
  await execFileAsync("git", ["init"], { cwd: repo });
  await writeFile(
    contractPath,
    `goal:
  id: audit
  name: Audit
  objective: Audit git changes.
scope:
  allowedArtifacts:
    - src/**
  forbiddenArtifacts:
    - secrets/**
  allowedOperations:
    - fs:write
  forbiddenOperations: []
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
  await execFileAsync(process.execPath, [cli(), "start", "--contract", contractPath, "--run", runDir]);
  await writeFile(join(repo, "src", "ok.ts"), "export const ok = true;\n", "utf8");
  await writeFile(join(repo, "secrets", "key.txt"), "secret\n", "utf8");

  const diff = JSON.parse(
    (await execFileAsync(process.execPath, [cli(), "diff", "--run", runDir, "--cwd", repo])).stdout
  ) as { changedArtifacts: Array<{ path: string }> };

  assert.deepEqual(
    diff.changedArtifacts.map((artifact) => artifact.path).sort(),
    ["secrets/key.txt", "src/ok.ts"]
  );

  const auditOutput = await execAllowFailure(process.execPath, [
    cli(),
    "audit",
    "--run",
    runDir,
    "--cwd",
    repo
  ]);
  const audit = JSON.parse(auditOutput.stdout) as {
    allowed: boolean;
    forbiddenMatches: string[];
    outOfScopeArtifacts: string[];
    report: string;
  };

  assert.equal(audit.allowed, false);
  assert.deepEqual(audit.forbiddenMatches, ["secrets/key.txt"]);
  assert.deepEqual(audit.outOfScopeArtifacts, ["secrets/key.txt"]);
  assert.match(await readFile(audit.report, "utf8"), /secrets\/key\.txt/);
});
