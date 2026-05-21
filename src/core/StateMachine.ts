import type { GoalContract } from "./GoalContract.js";
import type { ProgressMetrics } from "./ProgressEvaluator.js";
import type { VerificationResult } from "./RunLedger.js";

export const PHASES = [
  "DIVERGE_PLAN",
  "CONVERGE_EXECUTE",
  "VERIFY",
  "REPAIR",
  "ESCAPE_DIVERGE",
  "FINISH",
  "NEED_HUMAN",
  "ABORT"
] as const;

export type Phase = (typeof PHASES)[number];

export interface StateTransition {
  from: Phase;
  to: Phase;
  reason: string;
  metrics: ProgressMetrics;
}

export interface TransitionSignals {
  metrics: ProgressMetrics;
  verificationResult?: VerificationResult;
  actionCompleted?: boolean;
  repairCompleted?: boolean;
  selectedStrategyReady?: boolean;
  alternativeStrategySelected?: boolean;
  successCriteriaMet?: boolean;
  permissionRequired?: boolean;
  humanApproved?: boolean;
  humanDenied?: boolean;
  stopReason?: string;
  escapeRounds: number;
}

function toTransition(from: Phase, to: Phase, reason: string, metrics: ProgressMetrics): StateTransition {
  return { from, to, reason, metrics };
}

export class StateMachine {
  transition(from: Phase, contract: GoalContract, signals: TransitionSignals): StateTransition {
    if (from === "FINISH" || from === "ABORT") {
      return toTransition(from, from, `${from} is terminal`, signals.metrics);
    }

    if (from === "VERIFY" && signals.successCriteriaMet && signals.verificationResult === "pass") {
      return toTransition(from, "FINISH", "success criteria and verification passed", signals.metrics);
    }

    if (signals.stopReason) {
      return toTransition(from, "ABORT", signals.stopReason, signals.metrics);
    }

    if (signals.permissionRequired) {
      return toTransition(from, "NEED_HUMAN", "action requires human permission", signals.metrics);
    }

    switch (from) {
      case "DIVERGE_PLAN":
        return signals.selectedStrategyReady
          ? toTransition(from, "CONVERGE_EXECUTE", "strategy selected", signals.metrics)
          : toTransition(from, from, "waiting for a bounded strategy", signals.metrics);
      case "CONVERGE_EXECUTE":
        return signals.actionCompleted
          ? toTransition(from, "VERIFY", "supervised action completed", signals.metrics)
          : toTransition(from, from, "worker action is still pending", signals.metrics);
      case "VERIFY":
        if (
          signals.metrics.repeatedErrorCount >= contract.budget.maxSameError ||
          signals.metrics.noProgressCount >= contract.budget.maxNoProgress
        ) {
          return toTransition(from, "ESCAPE_DIVERGE", "repeated failure or no progress", signals.metrics);
        }

        if (signals.verificationResult === "fail" || signals.verificationResult === "partial") {
          return toTransition(from, "REPAIR", "verification requires local repair", signals.metrics);
        }

        return toTransition(from, "CONVERGE_EXECUTE", "verification did not finish the contract", signals.metrics);
      case "REPAIR":
        if (signals.metrics.repeatedErrorCount >= contract.budget.maxSameError) {
          return toTransition(from, "ESCAPE_DIVERGE", "repair repeated the same failure", signals.metrics);
        }

        return signals.repairCompleted
          ? toTransition(from, "VERIFY", "repair completed", signals.metrics)
          : toTransition(from, from, "repair is still pending", signals.metrics);
      case "ESCAPE_DIVERGE":
        if (signals.escapeRounds >= contract.budget.maxEscapeRounds) {
          return toTransition(from, "ABORT", "escape round budget reached", signals.metrics);
        }

        return signals.alternativeStrategySelected
          ? toTransition(from, "CONVERGE_EXECUTE", "alternative strategy selected", signals.metrics)
          : toTransition(from, from, "waiting for alternative strategy", signals.metrics);
      case "NEED_HUMAN":
        if (signals.humanDenied) {
          return toTransition(from, "ABORT", "human denied permission", signals.metrics);
        }

        return signals.humanApproved
          ? toTransition(from, "CONVERGE_EXECUTE", "human approved continuation", signals.metrics)
          : toTransition(from, from, "waiting for human input", signals.metrics);
    }
  }
}
