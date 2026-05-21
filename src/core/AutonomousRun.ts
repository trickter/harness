import { ArtifactGraph } from "../artifacts/ArtifactGraph.js";
import type {
  AutonomousPlan,
  AutonomousPlanner,
  AutonomousSupervisor,
  AutonomousVerifier,
  AutonomousWorker,
  AutonomousWorkerResult
} from "../agents/AutonomousTypes.js";
import type { GoalContract } from "./GoalContract.js";
import { LoopController, type HarnessContext, type LoopTurnResult } from "./LoopController.js";
import type { RunLedgerEntry } from "./RunLedger.js";
import type { Phase } from "./StateMachine.js";
import type { VerificationRunResult } from "./VerificationRunner.js";

export interface AutonomousRunResult {
  phase: Phase;
  ledger: RunLedgerEntry[];
  plans: AutonomousPlan[];
  workerResults: AutonomousWorkerResult[];
  verificationRuns: VerificationRunResult[];
}

export interface AutonomousRunOptions {
  cwd?: string;
}

function isTerminal(phase: Phase): boolean {
  return phase === "FINISH" || phase === "NEED_HUMAN" || phase === "ABORT";
}

export class AutonomousRun {
  readonly contract: GoalContract;
  readonly loop: LoopController;
  readonly planner: AutonomousPlanner;
  readonly supervisor: AutonomousSupervisor;
  readonly worker: AutonomousWorker;
  readonly verifier: AutonomousVerifier;
  readonly artifacts: ArtifactGraph;

  constructor(
    contract: GoalContract,
    loop: LoopController,
    planner: AutonomousPlanner,
    supervisor: AutonomousSupervisor,
    worker: AutonomousWorker,
    verifier: AutonomousVerifier,
    artifacts = new ArtifactGraph()
  ) {
    this.contract = contract;
    this.loop = loop;
    this.planner = planner;
    this.supervisor = supervisor;
    this.worker = worker;
    this.verifier = verifier;
    this.artifacts = artifacts;
  }

  async run(options: AutonomousRunOptions = {}): Promise<AutonomousRunResult> {
    const plans: AutonomousPlan[] = [];
    const workerResults: AutonomousWorkerResult[] = [];
    const verificationRuns: VerificationRunResult[] = [];
    let pendingPlan: AutonomousPlan | undefined;

    while (true) {
      const ledger = await this.loop.ledger.readAll();
      const phase = ledger.at(-1)?.nextPhase ?? "DIVERGE_PLAN";

      if (isTerminal(phase)) {
        return { phase, ledger, plans, workerResults, verificationRuns };
      }

      const context = this.context(phase, ledger);

      if (phase === "DIVERGE_PLAN" || phase === "ESCAPE_DIVERGE") {
        pendingPlan = await this.planner.plan(context);
        plans.push(pendingPlan);

        const decision = await this.supervisor.review(pendingPlan, context);
        await this.recordPlanningTurn(context, pendingPlan, decision.approved, decision.reason);
        continue;
      }

      if (phase === "VERIFY") {
        verificationRuns.push(await this.verifier.verify(options));
        pendingPlan = undefined;
        continue;
      }

      if (phase === "CONVERGE_EXECUTE" || phase === "REPAIR") {
        pendingPlan ??= await this.planner.plan(context);

        if (!plans.includes(pendingPlan)) {
          plans.push(pendingPlan);
        }

        const decision = await this.supervisor.review(pendingPlan, context);

        if (!decision.approved) {
          await this.recordWorkerTurn(context, pendingPlan, undefined, decision.reason, true);
          pendingPlan = undefined;
          continue;
        }

        const workerResult = await this.worker.execute(pendingPlan.action, context);
        workerResults.push(workerResult);
        await this.recordWorkerTurn(context, pendingPlan, workerResult, decision.reason, false);
        pendingPlan = undefined;
        continue;
      }

      throw new Error(`autonomous run does not know how to handle phase ${phase}`);
    }
  }

  private context(phase: Phase, ledger: RunLedgerEntry[]): HarnessContext {
    return {
      contract: this.contract,
      phase,
      ledger,
      artifacts: this.artifacts,
      permissions: this.loop.permissions,
      runtime: this.loop.runtime
    };
  }

  private async recordPlanningTurn(
    context: HarnessContext,
    plan: AutonomousPlan,
    approved: boolean,
    supervisorReason: string
  ): Promise<LoopTurnResult> {
    return this.loop.recordTurn({
      phase: context.phase,
      action: `Plan next action: ${plan.action.summary}`,
      changedArtifacts: [],
      commandsRun: [],
      verificationResult: "skipped",
      currentHypothesis: plan.currentHypothesis,
      newInformation: [plan.strategy, ...plan.newInformation, `Supervisor: ${supervisorReason}`],
      permissionRequired: !approved,
      selectedStrategyReady: approved && context.phase === "DIVERGE_PLAN",
      alternativeStrategySelected: approved && context.phase === "ESCAPE_DIVERGE"
    });
  }

  private async recordWorkerTurn(
    context: HarnessContext,
    plan: AutonomousPlan,
    workerResult: AutonomousWorkerResult | undefined,
    supervisorReason: string,
    permissionRequired: boolean
  ): Promise<LoopTurnResult> {
    const changedArtifacts = workerResult?.changedArtifacts ?? [];
    const workerScopeDecision = workerResult
      ? context.permissions.evaluate({
          operation: plan.action.operation,
          artifacts: changedArtifacts,
          destructive: plan.action.destructive,
          externalNetwork: plan.action.externalNetwork,
          secretAccess: plan.action.secretAccess
        })
      : undefined;
    const resultPermissionRequired = permissionRequired || workerScopeDecision?.allowed === false;
    const workerInformation = workerResult
      ? [workerResult.summary, ...workerResult.newInformation]
      : ["Worker skipped because supervisor did not approve the action."];

    return this.loop.recordTurn({
      phase: context.phase,
      action: workerResult ? plan.action.summary : `Reject action: ${plan.action.summary}`,
      changedArtifacts,
      commandsRun: workerResult?.commandsRun ?? [],
      verificationResult: "skipped",
      currentHypothesis: plan.currentHypothesis,
      newInformation: [
        `Supervisor: ${supervisorReason}`,
        ...(workerScopeDecision && !workerScopeDecision.allowed ? [`Worker scope: ${workerScopeDecision.reason}`] : []),
        ...workerInformation
      ],
      permissionRequired: resultPermissionRequired,
      actionCompleted: Boolean(workerResult) && context.phase === "CONVERGE_EXECUTE",
      repairCompleted: Boolean(workerResult) && context.phase === "REPAIR",
      objectiveDelta: changedArtifacts.length > 0 ? 0.1 : 0
    });
  }
}
