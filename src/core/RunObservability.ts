import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessRunPaths } from "./RunDirectory.js";
import type { RunLedgerEntry, VerificationResult } from "./RunLedger.js";
import { runGit, scanGitChangedArtifacts, type GitChangedArtifact } from "./ScopeAudit.js";

interface GitCapture {
  args: string[];
  output?: string;
  error?: string;
}

export interface VerificationCommandArtifact {
  command: string;
  operation: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  parsed: {
    summary: string;
    failureCount: number;
    errorSignature?: string;
  };
}

export interface VerificationRunArtifactInput {
  commands: VerificationCommandArtifact[];
  turn: {
    entry: Pick<RunLedgerEntry, "iteration" | "timestamp">;
  };
  verificationResult: VerificationResult;
}

export interface TurnDiffArtifact {
  path: string;
  iteration: number;
  workspaceArtifacts: GitChangedArtifact[];
}

function turnId(iteration: number): string {
  return `turn-${iteration.toString().padStart(4, "0")}`;
}

async function captureGit(args: string[], cwd: string): Promise<GitCapture> {
  try {
    return {
      args,
      output: await runGit(args, cwd)
    };
  } catch (error) {
    return {
      args,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function writeTurnDiffArtifact(input: {
  paths: HarnessRunPaths;
  cwd: string;
  entry: RunLedgerEntry;
}): Promise<TurnDiffArtifact> {
  const directory = join(input.paths.reportsDir, "diffs");
  const path = join(directory, `${turnId(input.entry.iteration)}.json`);
  const [workspaceArtifacts, workingTreeDiff, stagedDiff] = await Promise.all([
    scanGitChangedArtifacts(input.cwd),
    captureGit(["diff", "--binary"], input.cwd),
    captureGit(["diff", "--cached", "--binary"], input.cwd)
  ]);

  await mkdir(directory, { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        iteration: input.entry.iteration,
        phase: input.entry.phase,
        nextPhase: input.entry.nextPhase,
        action: input.entry.action,
        timestamp: input.entry.timestamp,
        declaredChangedArtifacts: input.entry.changedArtifacts,
        workspaceArtifacts,
        workingTreeDiff,
        stagedDiff
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return {
    path,
    iteration: input.entry.iteration,
    workspaceArtifacts
  };
}

export async function writeVerificationRunArtifacts(
  paths: HarnessRunPaths,
  result: VerificationRunArtifactInput
): Promise<{ directory: string; summaryPath: string }> {
  const directory = join(paths.verificationDir, turnId(result.turn.entry.iteration));
  const summaryPath = join(directory, "summary.json");

  await mkdir(directory, { recursive: true });
  await Promise.all(
    result.commands.flatMap((command, index) => {
      const prefix = `command-${(index + 1).toString().padStart(3, "0")}`;

      return [
        writeFile(
          join(directory, `${prefix}.json`),
          `${JSON.stringify(
            {
              command: command.command,
              operation: command.operation,
              exitCode: command.exitCode,
              parsed: command.parsed
            },
            null,
            2
          )}\n`,
          "utf8"
        ),
        writeFile(join(directory, `${prefix}.stdout.log`), command.stdout, "utf8"),
        writeFile(join(directory, `${prefix}.stderr.log`), command.stderr, "utf8")
      ];
    })
  );
  await writeFile(
    summaryPath,
    `${JSON.stringify(
      {
        iteration: result.turn.entry.iteration,
        timestamp: result.turn.entry.timestamp,
        verificationResult: result.verificationResult,
        commands: result.commands.map((command) => ({
          command: command.command,
          operation: command.operation,
          exitCode: command.exitCode,
          failureCount: command.parsed.failureCount,
          errorSignature: command.parsed.errorSignature
        }))
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return { directory, summaryPath };
}
