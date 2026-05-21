import type { ArtifactGraph } from "../artifacts/ArtifactGraph.js";
import type { GoalContract } from "./GoalContract.js";
import { PermissionPolicy } from "./PermissionPolicy.js";
import { ProgressEvaluator, type ProgressObservation } from "./ProgressEvaluator.js";
import type { RunLedgerEntry, RunLedgerStore } from "./RunLedger.js";
import { StateMachine, type Phase, type StateTransition, type TransitionSignals } from "./StateMachine.js";
import { StopPolicy, type StopDecision } from "./StopPolicy.js";

export interface HarnessRuntime {
  startedAt: string;
  iteration: number;
  escapeRounds: number;
}

export interface HarnessContext {
  contract: GoalContract;
  phase: Phase;
  ledger: RunLedgerEntry[];
  artifacts: ArtifactGraph;
  permissions: PermissionPolicy;
  runtime: HarnessRuntime;
}

export interface LoopTurnInput extends ProgressObservation {
  phase?: Phase;
  commandsRun: string[];
  currentHypothesis?: string;
  selectedStrategyReady?: boolean;
  alternativeStrategySelected?: boolean;
  actionCompleted?: boolean;
  repairCompleted?: boolean;
  successCriteriaMet?: boolean;
  permissionRequired?: boolean;
  humanApproved?: boolean;
  humanDenied?: boolean;
}

export interface LoopTurnResult {
  entry: RunLedgerEntry;
  transition: StateTransition;
  stopDecision: StopDecision;
}

export class LoopController {
  readonly contract: GoalContract;
  readonly ledger: RunLedgerStore;
  readonly permissions: PermissionPolicy;
  readonly runtime: HarnessRuntime;
  readonly progressEvaluator: ProgressEvaluator;
  readonly stateMachine: StateMachine;
  readonly stopPolicy: StopPolicy;

  constructor(
    contract: GoalContract,
    ledger: RunLedgerStore,
    options: {
      runtime?: Partial<HarnessRuntime>;
      permissions?: PermissionPolicy;
      progressEvaluator?: ProgressEvaluator;
      stateMachine?: StateMachine;
      stopPolicy?: StopPolicy;
    } = {}
  ) {
    this.contract = contract;
    this.ledger = ledger;
    this.permissions = options.permissions ?? new PermissionPolicy(contract);
    this.progressEvaluator = options.progressEvaluator ?? new ProgressEvaluator();
    this.stateMachine = options.stateMachine ?? new StateMachine();
    this.stopPolicy = options.stopPolicy ?? new StopPolicy();
    this.runtime = {
      startedAt: options.runtime?.startedAt ?? new Date().toISOString(),
      iteration: options.runtime?.iteration ?? 0,
      escapeRounds: options.runtime?.escapeRounds ?? 0
    };
  }

  async recordTurn(input: LoopTurnInput): Promise<LoopTurnResult> {
    const priorEntries = await this.ledger.readAll();
    const phase = input.phase ?? priorEntries.at(-1)?.nextPhase ?? "DIVERGE_PLAN";
    const iteration = priorEntries.length + 1;
    const evaluation = this.progressEvaluator.evaluate(priorEntries, input);
    const preview = this.createEntry(input, {
      iteration,
      phase,
      nextPhase: phase,
      progressSignal: evaluation.signal,
      metrics: evaluation.metrics
    });
    const stopDecision = this.stopPolicy.evaluate(this.contract, {
      startedAt: this.runtime.startedAt,
      iteration,
      escapeRounds: this.runtime.escapeRounds,
      ledger: [...priorEntries, preview],
      metrics: evaluation.metrics
    });
    const transitionSignals: TransitionSignals = {
      metrics: evaluation.metrics,
      verificationResult: input.verificationResult,
      selectedStrategyReady: input.selectedStrategyReady,
      alternativeStrategySelected: input.alternativeStrategySelected,
      actionCompleted: input.actionCompleted,
      repairCompleted: input.repairCompleted,
      successCriteriaMet: input.successCriteriaMet,
      permissionRequired: input.permissionRequired,
      humanApproved: input.humanApproved,
      humanDenied: input.humanDenied,
      stopReason: stopDecision.reason,
      escapeRounds: this.runtime.escapeRounds
    };
    const transition = this.stateMachine.transition(phase, this.contract, transitionSignals);
    const entry = { ...preview, nextPhase: transition.to };

    await this.ledger.append(entry);
    this.runtime.iteration = iteration;

    if (transition.to === "ESCAPE_DIVERGE" && phase !== "ESCAPE_DIVERGE") {
      this.runtime.escapeRounds += 1;
    }

    return { entry, transition, stopDecision };
  }

  private createEntry(
    input: LoopTurnInput,
    metadata: Pick<RunLedgerEntry, "iteration" | "phase" | "nextPhase" | "progressSignal" | "metrics">
  ): RunLedgerEntry {
    return {
      iteration: metadata.iteration,
      phase: metadata.phase,
      goalId: this.contract.goal.id,
      currentHypothesis: input.currentHypothesis,
      action: input.action,
      changedArtifacts: input.changedArtifacts,
      commandsRun: input.commandsRun,
      verificationResult: input.verificationResult,
      errorSignature: input.errorSignature,
      progressSignal: metadata.progressSignal,
      newInformation: input.newInformation,
      metrics: metadata.metrics,
      nextPhase: metadata.nextPhase,
      timestamp: new Date().toISOString()
    };
  }
}
