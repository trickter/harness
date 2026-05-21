import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { loadGoalContract, type GoalContract } from "./GoalContract.js";
import { JsonlRunLedger, type RunLedgerEntry } from "./RunLedger.js";
import type { Phase } from "./StateMachine.js";

export interface HarnessRunPaths {
  runDir: string;
  contractPath: string;
  ledgerPath: string;
  statusPath: string;
  verificationDir: string;
  reportsDir: string;
  snapshotsDir: string;
}

export interface HarnessRunStatus {
  goalId: string;
  goalName: string;
  runDir: string;
  contractPath: string;
  ledgerPath: string;
  phase: Phase;
  iterations: number;
  latestAction?: string;
  latestVerificationResult?: string;
  latestErrorSignature?: string;
  updatedAt: string;
}

export interface HarnessRunResume {
  status: HarnessRunStatus;
  recommendedNextStep: string;
  commands: string[];
}

export function runPaths(runDir: string): HarnessRunPaths {
  const resolved = resolve(runDir);

  return {
    runDir: resolved,
    contractPath: join(resolved, "contract.yaml"),
    ledgerPath: join(resolved, "ledger.jsonl"),
    statusPath: join(resolved, "status.json"),
    verificationDir: join(resolved, "verification"),
    reportsDir: join(resolved, "reports"),
    snapshotsDir: join(resolved, "snapshots")
  };
}

export async function ensureRunDirectories(paths: HarnessRunPaths): Promise<void> {
  await Promise.all([
    mkdir(paths.runDir, { recursive: true }),
    mkdir(paths.verificationDir, { recursive: true }),
    mkdir(paths.reportsDir, { recursive: true }),
    mkdir(paths.snapshotsDir, { recursive: true })
  ]);
}

export async function startHarnessRun(input: {
  contractPath: string;
  runDir?: string;
}): Promise<{ contract: GoalContract; paths: HarnessRunPaths; status: HarnessRunStatus }> {
  const contract = await loadGoalContract(input.contractPath);
  const paths = runPaths(input.runDir ?? join(".harness", "runs", contract.goal.id));

  await ensureRunDirectories(paths);
  await writeFile(paths.contractPath, stringifyYaml(contract), "utf8");

  const status = await writeRunStatus(paths);

  return { contract, paths, status };
}

export async function loadRunContract(paths: HarnessRunPaths): Promise<GoalContract> {
  return loadGoalContract(paths.contractPath);
}

export async function readRunStatus(paths: HarnessRunPaths): Promise<HarnessRunStatus> {
  try {
    return JSON.parse(await readFile(paths.statusPath, "utf8")) as HarnessRunStatus;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return writeRunStatus(paths);
    }

    throw error;
  }
}

export async function writeRunStatus(paths: HarnessRunPaths): Promise<HarnessRunStatus> {
  const contract = await loadRunContract(paths);
  const entries = await new JsonlRunLedger(paths.ledgerPath).readAll();
  const latest = entries.at(-1);
  const status: HarnessRunStatus = {
    goalId: contract.goal.id,
    goalName: contract.goal.name,
    runDir: paths.runDir,
    contractPath: paths.contractPath,
    ledgerPath: paths.ledgerPath,
    phase: latest?.nextPhase ?? "DIVERGE_PLAN",
    iterations: entries.length,
    latestAction: latest?.action,
    latestVerificationResult: latest?.verificationResult,
    latestErrorSignature: latest?.errorSignature,
    updatedAt: new Date().toISOString()
  };

  await writeFile(paths.statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");

  return status;
}

function commandForPhase(status: HarnessRunStatus): HarnessRunResume {
  const base = `--run ${JSON.stringify(status.runDir)}`;

  if (status.phase === "DIVERGE_PLAN") {
    return {
      status,
      recommendedNextStep: "Plan one bounded strategy and record it before editing.",
      commands: [
        `harness turn ${base} --phase DIVERGE_PLAN --action "Plan next bounded action" --verification skipped --hypothesis "..." --info "..." --selected-strategy-ready`
      ]
    };
  }

  if (status.phase === "CONVERGE_EXECUTE") {
    return {
      status,
      recommendedNextStep: "Execute one bounded action, then record changed artifacts.",
      commands: [
        `harness turn ${base} --phase CONVERGE_EXECUTE --action "..." --verification skipped --changed <path> --info "..." --action-completed --objective-delta 0.1`
      ]
    };
  }

  if (status.phase === "VERIFY") {
    return {
      status,
      recommendedNextStep: "Run configured verification commands.",
      commands: [`harness verify ${base}`]
    };
  }

  if (status.phase === "REPAIR") {
    return {
      status,
      recommendedNextStep: "Repair only the current verification failure, then record the repair.",
      commands: [
        `harness turn ${base} --phase REPAIR --action "Repair current verification failure" --verification skipped --changed <path> --info "..." --repair-completed --objective-delta 0.1`
      ]
    };
  }

  if (status.phase === "ESCAPE_DIVERGE") {
    return {
      status,
      recommendedNextStep: "Summarize the failed path, choose a materially different strategy, and record escape planning.",
      commands: [
        `harness turn ${base} --phase ESCAPE_DIVERGE --action "Choose alternative strategy" --verification skipped --hypothesis "..." --info "..." --alternative-strategy-selected`
      ]
    };
  }

  return {
    status,
    recommendedNextStep: `Run is terminal at ${status.phase}.`,
    commands: []
  };
}

export async function resumeHarnessRun(paths: HarnessRunPaths): Promise<HarnessRunResume> {
  return commandForPhase(await writeRunStatus(paths));
}

export function summarizeLedger(entries: RunLedgerEntry[]): {
  entries: number;
  phases: Record<string, number>;
  verification: Record<string, number>;
} {
  const countBy = (key: "phase" | "verificationResult"): Record<string, number> =>
    entries.reduce<Record<string, number>>((counts, entry) => {
      const value = entry[key];
      counts[value] = (counts[value] ?? 0) + 1;
      return counts;
    }, {});

  return {
    entries: entries.length,
    phases: countBy("phase"),
    verification: countBy("verificationResult")
  };
}
