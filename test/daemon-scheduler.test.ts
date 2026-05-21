import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { DaemonSpec } from "../src/agents/DaemonAgent.js";
import { DaemonScheduler, type DaemonRegistration } from "../src/agents/DaemonScheduler.js";
import { parseGoalContract } from "../src/core/GoalContract.js";
import { runPaths } from "../src/core/RunDirectory.js";
import { JsonlRunLedger } from "../src/core/RunLedger.js";

const execFileAsync = promisify(execFile);

function cli(): string {
  return join(process.cwd(), "dist", "src", "cli", "index.js");
}

function daemonSpec(input: Pick<DaemonSpec, "name" | "outputMode" | "trigger">): DaemonSpec {
  return {
    ...input,
    scope: ["src/**", "docs/**", "README*"],
    maxRuntimeMinutes: 5,
    maxActionsPerRun: 2,
    stopConditions: ["done"]
  };
}

function contract() {
  return parseGoalContract({
    goal: {
      id: "daemon-scheduler",
      name: "Daemon Scheduler",
      objective: "Dispatch bounded daemons."
    },
    scope: {
      allowedArtifacts: ["src/**", "docs/**", "README*"]
    }
  });
}

async function createGitWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "harness-daemon-scheduler-"));

  await execFileAsync("git", ["init"], { cwd: directory });
  await writeFile(join(directory, ".gitignore"), ".harness/\n", "utf8");

  return directory;
}

test("daemon scheduler writes documentation runs to isolated ledger and report paths", async () => {
  const cwd = await createGitWorkspace();
  const paths = runPaths(join(cwd, ".harness", "runs", "daemon-scheduler"));
  const dispatch = await new DaemonScheduler({ contract: contract(), cwd, paths }).dispatch({
    trigger: "on_file_change",
    changedArtifacts: ["src/webhooks/signature.ts"]
  });
  const run = dispatch.runs[0];

  assert.equal(dispatch.runs.length, 1);
  assert.equal(run?.daemon, "documentation-consistency-daemon");
  assert.equal(run?.ledgerEntries, 1);
  assert.equal(run?.isolation.valid, true);
  assert.equal((await new JsonlRunLedger(paths.ledgerPath).readAll()).length, 0);
  assert.equal((await new JsonlRunLedger(run?.paths.ledgerPath ?? "").readAll()).length, 1);
  assert.match(await readFile(run?.paths.reportPath ?? "", "utf8"), /needsDocumentationReview/);
});

test("scheduled daemon dispatch isolates report, suggestion, and auto patch output modes", async () => {
  const cwd = await createGitWorkspace();
  const paths = runPaths(join(cwd, ".harness", "runs", "output-modes"));
  const reportOnly: DaemonRegistration = {
    spec: daemonSpec({ name: "report-daemon", outputMode: "report_only", trigger: ["scheduled"] }),
    async run() {
      return {
        report: { status: "reported" },
        patchSuggestions: [{ path: "src/report.ts", summary: "This suggestion is not allowed." }]
      };
    }
  };
  const suggestPatch: DaemonRegistration = {
    spec: daemonSpec({ name: "suggest-daemon", outputMode: "suggest_patch", trigger: ["scheduled"] }),
    async run() {
      return {
        report: { status: "suggested" },
        patchSuggestions: [{ path: "src/suggestion.ts", summary: "Add a bounded patch." }]
      };
    }
  };
  const autoPatch: DaemonRegistration = {
    spec: daemonSpec({ name: "auto-daemon", outputMode: "auto_patch", trigger: ["scheduled"] }),
    async run(_event, context) {
      await mkdir(join(context.cwd, "src"), { recursive: true });
      await writeFile(join(context.cwd, "src", "generated.ts"), "export const scheduled = true;\n", "utf8");

      return { report: { status: "patched" } };
    }
  };
  const dispatch = await new DaemonScheduler({
    contract: contract(),
    cwd,
    paths,
    registrations: [reportOnly, suggestPatch, autoPatch]
  }).dispatch({
    trigger: "scheduled",
    scheduledAt: "2026-05-21T00:00:00.000Z"
  });
  const byName = new Map(dispatch.runs.map((run) => [run.daemon, run]));

  assert.equal(byName.get("report-daemon")?.isolation.valid, false);
  assert.match(byName.get("report-daemon")?.isolation.violations[0] ?? "", /report_only/);
  assert.equal(byName.get("suggest-daemon")?.isolation.valid, true);
  assert.equal(byName.get("suggest-daemon")?.isolation.patchSuggestions.length, 1);
  assert.equal(byName.get("auto-daemon")?.isolation.valid, true);
  assert.deepEqual(byName.get("auto-daemon")?.isolation.changedArtifacts, [{ path: "src/generated.ts", status: "??" }]);
});

test("daemon dispatch CLI emits report paths for run-directory daemons", async () => {
  const cwd = await createGitWorkspace();
  const contractPath = join(cwd, "goal.yaml");
  const runDir = join(cwd, ".harness", "runs", "daemon-cli");

  await writeFile(
    contractPath,
    `goal:
  id: daemon-cli
  name: Daemon CLI
  objective: Dispatch a file-change daemon.
scope:
  allowedArtifacts: [src/**, docs/**, README*]
`,
    "utf8"
  );

  await execFileAsync(process.execPath, [cli(), "start", "--contract", contractPath, "--run", runDir, "--cwd", cwd]);

  const dispatch = JSON.parse(
    (
      await execFileAsync(process.execPath, [
        cli(),
        "daemon",
        "dispatch",
        "--run",
        runDir,
        "--trigger",
        "on_file_change",
        "--cwd",
        cwd,
        "--changed",
        "src/webhooks.ts"
      ])
    ).stdout
  ) as { runs: Array<{ paths: { ledgerPath: string; reportPath: string } }> };
  const run = dispatch.runs[0];

  assert.match(run?.paths.ledgerPath ?? "", /daemons/);
  await access(run?.paths.reportPath ?? "");
});
