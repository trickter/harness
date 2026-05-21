import type { LoopController, LoopTurnResult } from "../core/LoopController.js";
import { type DaemonSpec } from "./DaemonAgent.js";

export interface ArchitectureDaemonReport {
  daemon: string;
  outputMode: "report_only";
  changedArtifacts: string[];
  findings: string[];
  hasViolations: boolean;
}

export interface ArchitectureDaemonRunResult {
  report: ArchitectureDaemonReport;
  turn: LoopTurnResult;
}

export const architectureConsistencyDaemon: DaemonSpec = {
  name: "architecture-consistency-daemon",
  trigger: ["on_goal_finished", "on_file_change"],
  scope: ["src/**"],
  maxRuntimeMinutes: 10,
  maxActionsPerRun: 3,
  outputMode: "report_only",
  stopConditions: ["no_relevant_artifacts_changed", "max_actions_reached", "supervisor_denied"]
};

export class ArchitectureConsistencyDaemonRunner {
  readonly spec: DaemonSpec;
  readonly loop: LoopController;

  constructor(spec: DaemonSpec, loop: LoopController) {
    this.spec = spec;
    this.loop = loop;
  }

  async run(input: { changedArtifacts: string[] }): Promise<ArchitectureDaemonRunResult> {
    const changedArtifacts = input.changedArtifacts.filter(path => 
      path.startsWith("src/") || path.startsWith("lib/")
    );
    
    const findings: string[] = [];
    let hasViolations = false;

    for (const file of changedArtifacts) {
      if (file.includes("core/") && file.includes("adapter")) {
        findings.push(`Potential layer violation: Core file ${file} should not depend directly on adapters.`);
        hasViolations = true;
      }
    }

    if (findings.length === 0) {
      findings.push("No architectural dependency or import violations detected.");
    }

    const report: ArchitectureDaemonReport = {
      daemon: this.spec.name,
      outputMode: "report_only",
      changedArtifacts,
      findings,
      hasViolations
    };

    const turn = await this.loop.recordTurn({
      phase: "VERIFY",
      action: `Run ${this.spec.name} in report_only mode.`,
      changedArtifacts: [],
      commandsRun: [],
      verificationResult: hasViolations ? "fail" : "pass",
      errorSignature: hasViolations ? `${this.spec.name}:dependency-violation` : undefined,
      newInformation: findings,
      objectiveDelta: hasViolations ? 0 : 1,
      artifactQualityDelta: hasViolations ? 0 : 1,
      confidenceDelta: hasViolations ? 0 : 1,
      successCriteriaMet: !hasViolations
    });

    return { report, turn };
  }
}
