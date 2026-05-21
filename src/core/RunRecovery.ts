import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { GoalContract } from "./GoalContract.js";
import { RecoveryPolicy, type FailurePathEntry } from "./RecoveryPolicy.js";
import type { HarnessRunPaths } from "./RunDirectory.js";
import type { RunLedgerEntry } from "./RunLedger.js";
import {
  captureHarnessSnapshot,
  readHarnessSnapshot,
  type HarnessSnapshot,
  type SnapshotWorkspaceArtifact
} from "./RunSnapshot.js";
import {
  auditChangedArtifacts,
  captureGitArtifactSnapshots,
  type GitArtifactSnapshot,
  type GitChangedArtifact,
  type ScopeAuditResult
} from "./ScopeAudit.js";

export interface RecoveryPlan {
  goalId: string;
  baselineSnapshot: string;
  recoveryPoint: string;
  latestSnapshot: string;
  apply: boolean;
  latestArtifacts: GitChangedArtifact[];
  keptArtifacts: GitChangedArtifact[];
  rollbackArtifacts: GitChangedArtifact[];
  failurePath: FailurePathEntry[];
  scopeAudit: ScopeAuditResult;
  restoredArtifacts: string[];
  reportPath: string;
}

function diffSnapshots(from: GitArtifactSnapshot[], to: GitArtifactSnapshot[]): GitChangedArtifact[] {
  const fromByPath = new Map(from.map((artifact) => [artifact.path, artifact]));
  const toByPath = new Map(to.map((artifact) => [artifact.path, artifact]));
  const paths = new Set([...fromByPath.keys(), ...toByPath.keys()]);

  return [...paths]
    .filter((path) => fromByPath.get(path)?.fingerprint !== toByPath.get(path)?.fingerprint)
    .map((path) => {
      const artifact = toByPath.get(path) ?? fromByPath.get(path);

      return {
        path,
        status: artifact?.status ?? "M"
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function workspaceState(snapshot: HarnessSnapshot, path: string): SnapshotWorkspaceArtifact | undefined {
  return snapshot.workspaceArtifacts.find((artifact) => artifact.path === path);
}

function gitShowHead(path: string, cwd: string): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["show", `HEAD:${path}`],
      {
        cwd,
        encoding: "buffer",
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }

        const message = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr);

        if (/exists on disk, but not in|path .* does not exist|fatal: invalid object name 'HEAD'/i.test(message)) {
          resolve(undefined);
          return;
        }

        reject(new Error(message.trim() || error.message));
      }
    );
  });
}

async function writeWorkspaceState(cwd: string, path: string, state: SnapshotWorkspaceArtifact): Promise<void> {
  const absolutePath = safeWorkspacePath(cwd, path);

  if (!state.exists) {
    await rm(absolutePath, { force: true, recursive: true });
    return;
  }

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from(state.contentBase64 ?? "", "base64"));
}

async function restoreHeadState(cwd: string, path: string): Promise<void> {
  const absolutePath = safeWorkspacePath(cwd, path);
  const content = await gitShowHead(path, cwd);

  if (content === undefined) {
    await rm(absolutePath, { force: true, recursive: true });
    return;
  }

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

function safeWorkspacePath(cwd: string, path: string): string {
  const root = resolve(cwd);
  const absolutePath = resolve(root, path);
  const relativePath = relative(root, absolutePath);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`recovery artifact ${path} resolves outside workspace ${root}`);
  }

  return absolutePath;
}

async function restorePaths(input: {
  cwd: string;
  target: HarnessSnapshot;
  paths: GitChangedArtifact[];
}): Promise<string[]> {
  const restored: string[] = [];

  for (const artifact of input.paths) {
    const targetState = workspaceState(input.target, artifact.path);

    if (targetState) {
      await writeWorkspaceState(input.cwd, artifact.path, targetState);
    } else if (input.target.artifacts.some((targetArtifact) => targetArtifact.path === artifact.path)) {
      throw new Error(
        `snapshot ${input.target.name} has no restorable workspace payload for ${artifact.path}; capture it again`
      );
    } else {
      await restoreHeadState(input.cwd, artifact.path);
    }

    restored.push(artifact.path);
  }

  return restored;
}

async function chooseRecoverySnapshot(paths: HarnessRunPaths, preferred?: string): Promise<HarnessSnapshot> {
  if (preferred) {
    return readHarnessSnapshot(paths, preferred);
  }

  try {
    return await readHarnessSnapshot(paths, "healthy");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    return readHarnessSnapshot(paths, "baseline");
  }
}

export async function recoverHarnessRun(input: {
  paths: HarnessRunPaths;
  contract: GoalContract;
  ledger: RunLedgerEntry[];
  cwd: string;
  from?: string;
  apply?: boolean;
}): Promise<RecoveryPlan> {
  const baseline = await readHarnessSnapshot(input.paths, "baseline");
  const target = await chooseRecoverySnapshot(input.paths, input.from);
  const latest = await captureHarnessSnapshot({
    paths: input.paths,
    cwd: input.cwd,
    name: "latest"
  });
  const keptArtifacts = diffSnapshots(baseline.artifacts, target.artifacts);
  const latestArtifacts = diffSnapshots(baseline.artifacts, latest.artifacts);
  const rollbackArtifacts = diffSnapshots(target.artifacts, latest.artifacts);
  const restoredArtifacts = input.apply
    ? await restorePaths({
        cwd: input.cwd,
        target,
        paths: rollbackArtifacts
      })
    : [];
  const currentArtifacts = input.apply ? await captureGitArtifactSnapshots(input.cwd) : latest.artifacts;
  const scopeAudit = auditChangedArtifacts({
    contract: input.contract,
    cwd: input.cwd,
    changedArtifacts: diffSnapshots(baseline.artifacts, currentArtifacts)
  });
  const failurePath = new RecoveryPolicy().failurePathSinceHealthy(input.ledger, target.ledgerIteration);
  const reportPath = join(input.paths.reportsDir, "recovery.json");
  const plan: RecoveryPlan = {
    goalId: input.contract.goal.id,
    baselineSnapshot: baseline.name,
    recoveryPoint: target.name,
    latestSnapshot: latest.name,
    apply: Boolean(input.apply),
    latestArtifacts,
    keptArtifacts,
    rollbackArtifacts,
    failurePath,
    scopeAudit,
    restoredArtifacts,
    reportPath
  };

  await mkdir(input.paths.reportsDir, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  return plan;
}
