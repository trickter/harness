import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  captureGitArtifactSnapshots,
  changedSinceBaseline,
  type GitArtifactSnapshot,
  type GitChangedArtifact
} from "./ScopeAudit.js";
import type { HarnessRunPaths } from "./RunDirectory.js";

export interface HarnessSnapshot {
  name: string;
  cwd: string;
  capturedAt: string;
  artifacts: GitArtifactSnapshot[];
}

export function snapshotPath(paths: HarnessRunPaths, name: string): string {
  return join(paths.snapshotsDir, `${name}.json`);
}

export async function captureHarnessSnapshot(input: {
  paths: HarnessRunPaths;
  cwd: string;
  name: string;
}): Promise<HarnessSnapshot> {
  const snapshot: HarnessSnapshot = {
    name: input.name,
    cwd: input.cwd,
    capturedAt: new Date().toISOString(),
    artifacts: await captureGitArtifactSnapshots(input.cwd)
  };

  await writeFile(snapshotPath(input.paths, input.name), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  return snapshot;
}

export async function readHarnessSnapshot(paths: HarnessRunPaths, name: string): Promise<HarnessSnapshot> {
  return JSON.parse(await readFile(snapshotPath(paths, name), "utf8")) as HarnessSnapshot;
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
