import type { HarnessContext } from "../core/LoopController.js";
import type { HarnessRunPaths } from "../core/RunDirectory.js";
import type { VerificationRunResult } from "../core/VerificationRunner.js";

export interface AutonomousAction {
  summary: string;
  operation: string;
  artifacts: string[];
  prompt: string;
  destructive?: boolean;
  externalNetwork?: boolean;
  secretAccess?: boolean;
}

export interface AutonomousPlan {
  strategy: string;
  currentHypothesis: string;
  action: AutonomousAction;
  newInformation: string[];
}

export interface AutonomousWorkerResult {
  summary: string;
  changedArtifacts: string[];
  commandsRun: string[];
  newInformation: string[];
}

export interface AutonomousPlanner {
  plan(context: HarnessContext): Promise<AutonomousPlan>;
}

export interface SupervisorDecision {
  approved: boolean;
  requiresHuman: boolean;
  reason: string;
}

export interface AutonomousSupervisor {
  review(plan: AutonomousPlan, context: HarnessContext): Promise<SupervisorDecision>;
}

export interface AutonomousWorker {
  execute(action: AutonomousAction, context: HarnessContext): Promise<AutonomousWorkerResult>;
}

export interface AutonomousVerifier {
  verify(options: { cwd?: string; paths?: HarnessRunPaths }): Promise<VerificationRunResult>;
}
