import type { GoalContract } from "./GoalContract.js";
import type { RunLedgerEntry } from "./RunLedger.js";

export interface RecoveryReport {
  goalId: string;
  failedPath: string[];
  keepAdvice: string[];
  humanReport: string;
}

export interface FailurePathEntry {
  iteration: number;
  phase: string;
  action: string;
  verificationResult: string;
  nextPhase: string;
  errorSignature?: string;
}

export class RecoveryPolicy {
  buildAbortReport(contract: GoalContract, ledger: RunLedgerEntry[], reason: string): RecoveryReport {
    const failedPath = ledger
      .filter((entry) => entry.verificationResult === "fail" || entry.progressSignal === "negative")
      .map((entry) => `${entry.phase}: ${entry.action}`);
    const changedArtifacts = new Set(ledger.flatMap((entry) => entry.changedArtifacts));

    return {
      goalId: contract.goal.id,
      failedPath,
      keepAdvice: changedArtifacts.size
        ? [`Review ${changedArtifacts.size} changed artifact(s) against the last passing verification.`]
        : ["No changed artifacts were recorded."],
      humanReport: `Harness aborted for ${contract.goal.name}: ${reason}`
    };
  }

  failurePathSinceHealthy(ledger: RunLedgerEntry[], healthyIteration?: number): FailurePathEntry[] {
    const latestPassedIteration =
      healthyIteration ??
      [...ledger].reverse().find((entry) => entry.verificationResult === "pass")?.iteration ??
      0;

    return ledger
      .filter((entry) => entry.iteration > latestPassedIteration)
      .map((entry) => ({
        iteration: entry.iteration,
        phase: entry.phase,
        action: entry.action,
        verificationResult: entry.verificationResult,
        nextPhase: entry.nextPhase,
        errorSignature: entry.errorSignature
      }));
  }
}
