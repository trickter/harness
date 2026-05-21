import type { GoalContract } from "./GoalContract.js";
import type { ProgressMetrics } from "./ProgressEvaluator.js";
import type { RunLedgerEntry } from "./RunLedger.js";

export interface RuntimeBudgetSnapshot {
  startedAt: string;
  iteration: number;
  escapeRounds: number;
  ledger: RunLedgerEntry[];
  metrics: ProgressMetrics;
}

export interface StopDecision {
  stop: boolean;
  reason?: string;
}

function changedArtifactCount(entries: RunLedgerEntry[]): number {
  return new Set(entries.flatMap((entry) => entry.changedArtifacts)).size;
}

export class StopPolicy {
  evaluate(contract: GoalContract, snapshot: RuntimeBudgetSnapshot): StopDecision {
    if (snapshot.iteration > contract.budget.maxIterations) {
      return { stop: true, reason: "maximum iteration budget reached" };
    }

    if (snapshot.escapeRounds > contract.budget.maxEscapeRounds) {
      return { stop: true, reason: "maximum escape round budget exceeded" };
    }

    if (snapshot.metrics.noProgressCount >= contract.budget.maxNoProgress) {
      return { stop: true, reason: "maximum no-progress budget reached" };
    }

    if (changedArtifactCount(snapshot.ledger) > contract.budget.maxChangedArtifacts) {
      return { stop: true, reason: "changed artifact budget exceeded" };
    }

    const elapsedMinutes = (Date.now() - Date.parse(snapshot.startedAt)) / 60_000;

    if (elapsedMinutes >= contract.budget.maxRuntimeMinutes) {
      return { stop: true, reason: "runtime budget reached" };
    }

    return { stop: false };
  }
}
