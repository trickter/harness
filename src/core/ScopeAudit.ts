import { execFile } from "node:child_process";
import type { GoalContract } from "./GoalContract.js";

export interface GitChangedArtifact {
  path: string;
  status: string;
}

export interface ScopeAuditResult {
  cwd: string;
  changedArtifacts: GitChangedArtifact[];
  allowedArtifacts: string[];
  forbiddenArtifacts: string[];
  outOfScopeArtifacts: string[];
  forbiddenMatches: string[];
  changedArtifactsCount: number;
  maxChangedArtifacts: number;
  exceedsChangedArtifactBudget: boolean;
  scopeDriftScore: number;
  allowed: boolean;
  recommendation: "continue" | "need_human";
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

export function matchesArtifactPattern(value: string, pattern: string): boolean {
  const normalizedValue = value.replaceAll("\\", "/");
  const normalizedPattern = pattern.replaceAll("\\", "/");
  const regex = escapeRegex(normalizedPattern)
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]*")
    .replaceAll("\0", ".*");

  return new RegExp(`^${regex}$`).test(normalizedValue);
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesArtifactPattern(value, pattern));
}

function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        resolve(stdout);
      }
    );
  });
}

function parsePorcelainLine(line: string): GitChangedArtifact | undefined {
  if (!line.trim()) {
    return undefined;
  }

  const status = line.slice(0, 2).trim() || line.slice(0, 2);
  const rawPath = line.slice(3).trim();
  const renamePath = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) : rawPath;
  const path = renamePath?.replaceAll("\\", "/");

  if (!path) {
    return undefined;
  }

  return { path, status };
}

export function parseGitStatusPorcelain(output: string): GitChangedArtifact[] {
  return output
    .split(/\r?\n/)
    .map(parsePorcelainLine)
    .filter((artifact): artifact is GitChangedArtifact => Boolean(artifact));
}

export async function scanGitChangedArtifacts(cwd: string): Promise<GitChangedArtifact[]> {
  const output = await runGit(["status", "--porcelain", "--untracked-files=all"], cwd);

  return parseGitStatusPorcelain(output);
}

export function auditChangedArtifacts(input: {
  contract: GoalContract;
  cwd: string;
  changedArtifacts: GitChangedArtifact[];
}): ScopeAuditResult {
  const changedPaths = [...new Set(input.changedArtifacts.map((artifact) => artifact.path))];
  const allowedArtifacts = changedPaths.filter((path) => matchesAny(path, input.contract.scope.allowedArtifacts));
  const forbiddenMatches = changedPaths.filter((path) => matchesAny(path, input.contract.scope.forbiddenArtifacts));
  const outOfScopeArtifacts = changedPaths.filter((path) => !matchesAny(path, input.contract.scope.allowedArtifacts));
  const exceedsChangedArtifactBudget = changedPaths.length > input.contract.budget.maxChangedArtifacts;
  const violationCount = new Set([...forbiddenMatches, ...outOfScopeArtifacts]).size;
  const scopeDriftScore =
    changedPaths.length === 0 ? 0 : Math.min(1, violationCount / changedPaths.length);
  const allowed = forbiddenMatches.length === 0 && outOfScopeArtifacts.length === 0 && !exceedsChangedArtifactBudget;

  return {
    cwd: input.cwd,
    changedArtifacts: input.changedArtifacts,
    allowedArtifacts,
    forbiddenArtifacts: input.contract.scope.forbiddenArtifacts,
    outOfScopeArtifacts,
    forbiddenMatches,
    changedArtifactsCount: changedPaths.length,
    maxChangedArtifacts: input.contract.budget.maxChangedArtifacts,
    exceedsChangedArtifactBudget,
    scopeDriftScore,
    allowed,
    recommendation: allowed ? "continue" : "need_human"
  };
}

export async function auditGitScope(input: {
  contract: GoalContract;
  cwd: string;
}): Promise<ScopeAuditResult> {
  return auditChangedArtifacts({
    contract: input.contract,
    cwd: input.cwd,
    changedArtifacts: await scanGitChangedArtifacts(input.cwd)
  });
}
