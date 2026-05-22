import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_SCOPE, type GoalContract } from "./GoalContract.js";
import {
  captureGitArtifactSnapshots,
  changedSinceBaseline,
  matchesArtifactPattern,
  type GitArtifactSnapshot,
  type GitChangedArtifact
} from "./ScopeAudit.js";
import type { HarnessRunPaths } from "./RunDirectory.js";

export interface HarnessSnapshot {
  name: string;
  cwd: string;
  capturedAt: string;
  artifacts: GitArtifactSnapshot[];
  workspaceArtifacts: SnapshotWorkspaceArtifact[];
  ledgerIteration?: number;
  verificationResult?: "pass" | "fail" | "partial" | "skipped";
}

export interface SnapshotWorkspaceArtifact {
  path: string;
  exists: boolean;
  redacted?: boolean;
  contentBase64?: string;
}

export function snapshotPath(paths: HarnessRunPaths, name: string): string {
  return join(paths.snapshotsDir, `${name}.json`);
}

export async function captureHarnessSnapshot(input: {
  paths: HarnessRunPaths;
  cwd: string;
  name: string;
  contract?: GoalContract;
  ledgerIteration?: number;
  verificationResult?: "pass" | "fail" | "partial" | "skipped";
}): Promise<HarnessSnapshot> {
  const artifacts = await captureGitArtifactSnapshots(input.cwd);
  const redactedPatterns = [...DEFAULT_SCOPE.forbiddenArtifacts, ...(input.contract?.scope.forbiddenArtifacts ?? [])];
  const snapshot: HarnessSnapshot = {
    name: input.name,
    cwd: input.cwd,
    capturedAt: new Date().toISOString(),
    artifacts,
    workspaceArtifacts: await Promise.all(
      artifacts.map(async (artifact) => {
        if (redactedPatterns.some((pattern) => matchesArtifactPattern(artifact.path, pattern))) {
          return {
            path: artifact.path,
            exists: true,
            redacted: true
          };
        }

        try {
          return {
            path: artifact.path,
            exists: true,
            contentBase64: (await readFile(join(input.cwd, artifact.path))).toString("base64")
          };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return {
              path: artifact.path,
              exists: false
            };
          }

          throw error;
        }
      })
    ),
    ledgerIteration: input.ledgerIteration,
    verificationResult: input.verificationResult
  };

  await mkdir(input.paths.snapshotsDir, { recursive: true });
  await writeFile(snapshotPath(input.paths, input.name), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  return snapshot;
}

export async function readHarnessSnapshot(paths: HarnessRunPaths, name: string): Promise<HarnessSnapshot> {
  const snapshot = JSON.parse(await readFile(snapshotPath(paths, name), "utf8")) as HarnessSnapshot;

  return {
    ...snapshot,
    workspaceArtifacts: snapshot.workspaceArtifacts ?? []
  };
}

export async function changedArtifactsSinceSnapshot(input: {
  paths: HarnessRunPaths;
  cwd: string;
  since: string;
}): Promise<GitChangedArtifact[]> {
  const baseline = await readHarnessSnapshot(input.paths, input.since);
  const current = await captureGitArtifactSnapshots(input.cwd);

  return changedSinceBaseline({
    baseline: baseline.artifacts,
    current
  });
}
