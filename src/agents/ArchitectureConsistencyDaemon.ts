import type { ArtifactGraph } from "../artifacts/ArtifactGraph.js";
import type { LoopController, LoopTurnResult } from "../core/LoopController.js";
import { type DaemonSpec } from "./DaemonAgent.js";

export interface ArchitectureDaemonReport {
  daemon: string;
  outputMode: "report_only";
  changedArtifacts: string[];
  dependencyViolations: string[];
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

  async run(input: { changedArtifacts: string[]; graph?: ArtifactGraph }): Promise<ArchitectureDaemonRunResult> {
    const changedArtifacts = input.changedArtifacts.filter(path =>
      path.startsWith("src/") || path.startsWith("lib/")
    );
    const dependencyViolations =
      input.graph?.listEdges().flatMap((edge) => {
        if (edge.relation !== "depends_on") {
          return [];
        }

        const from = input.graph?.getArtifact(edge.from);
        const to = input.graph?.getArtifact(edge.to);

        return from?.uri.match(/^(?:src|lib)\/core\//u) && to?.uri.match(/^(?:src|lib)\/adapters\//u)
          ? [`Dependency direction violation: ${from.uri} depends on adapter ${to.uri}.`]
          : [];
      }) ?? [];
    const findings: string[] = [...dependencyViolations];

    for (const file of changedArtifacts) {
      if (file.includes("core/") && file.includes("adapter")) {
        findings.push(`Potential layer violation: Core file ${file} should not depend directly on adapters.`);
      }
    }

    if (findings.length === 0) {
      findings.push("No architectural dependency or import violations detected.");
    }

    const hasViolations = findings.some(
      (finding) => finding !== "No architectural dependency or import violations detected."
    );
    const report: ArchitectureDaemonReport = {
      daemon: this.spec.name,
      outputMode: "report_only",
      changedArtifacts,
      dependencyViolations,
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
