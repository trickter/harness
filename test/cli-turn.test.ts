import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("CLI turn records a Codex-driven planning turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harness-cli-turn-"));
  const contractPath = join(directory, "goal.yaml");
  const ledgerPath = join(directory, "ledger.jsonl");

  await writeFile(
    contractPath,
    `goal:
  id: cli-turn
  name: CLI Turn
  objective: Record a manual harness turn.
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

  const result = await execFileAsync(process.execPath, [
    join(process.cwd(), "dist", "src", "cli", "index.js"),
    "turn",
    "--contract",
    contractPath,
    "--ledger",
    ledgerPath,
    "--phase",
    "DIVERGE_PLAN",
    "--action",
    "Plan a bounded action.",
    "--verification",
    "skipped",
    "--hypothesis",
    "The next step is known.",
    "--info",
    "Strategy is bounded.",
    "--selected-strategy-ready"
  ]);
  const summary = JSON.parse(result.stdout) as { nextPhase: string; progressSignal: string };
  const ledgerLines = (await readFile(ledgerPath, "utf8")).trim().split(/\r?\n/);

  assert.equal(summary.nextPhase, "CONVERGE_EXECUTE");
  assert.equal(summary.progressSignal, "neutral");
  assert.equal(ledgerLines.length, 1);
});
