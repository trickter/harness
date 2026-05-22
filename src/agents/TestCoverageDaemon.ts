import type { ArtifactGraph } from "../artifacts/ArtifactGraph.js";
import type { LoopController, LoopTurnResult } from "../core/LoopController.js";
import { type DaemonSpec } from "./DaemonAgent.js";

export interface TestCoverageDaemonReport {
  daemon: string;
  outputMode: "report_only";
  changedSourceFiles: string[];
  changedTestFiles: string[];
  validatedSourceFiles: string[];
  unvalidatedSourceFiles: string[];
  findings: string[];
  coverageGapDetected: boolean;
}

export interface TestCoverageDaemonRunResult {
  report: TestCoverageDaemonReport;
  turn: LoopTurnResult;
}

export const testCoverageDaemon: DaemonSpec = {
  name: "test-coverage-daemon",
  trigger: ["on_goal_finished", "on_file_change"],
  scope: ["src/**", "test/**"],
  maxRuntimeMinutes: 10,
  maxActionsPerRun: 3,
  outputMode: "report_only",
  stopConditions: ["no_relevant_artifacts_changed", "max_actions_reached", "supervisor_denied"]
};

export class TestCoverageDaemonRunner {
  readonly spec: DaemonSpec;
  readonly loop: LoopController;

  constructor(spec: DaemonSpec, loop: LoopController) {
    this.spec = spec;
    this.loop = loop;
  }

  async run(input: { changedArtifacts: string[]; graph?: ArtifactGraph }): Promise<TestCoverageDaemonRunResult> {
    const changedSourceFiles = input.changedArtifacts.filter(path =>
      path.startsWith("src/") && !path.endsWith(".test.ts") && !path.endsWith(".spec.ts")
    );
    const changedTestFiles = input.changedArtifacts.filter(path =>
      path.startsWith("test/") || path.endsWith(".test.ts") || path.endsWith(".spec.ts")
    );
    const validatedSourceFiles =
      input.graph?.listEdges().flatMap((edge) => {
        if (!["tests", "validates"].includes(edge.relation)) {
          return [];
        }

        const source = input.graph?.getArtifact(edge.to);
        const test = input.graph?.getArtifact(edge.from);

        return source?.type === "source_code" && test?.type === "test" ? [source.uri] : [];
      }) ?? [];
    const unvalidatedSourceFiles = input.graph
      ? changedSourceFiles.filter((path) => !validatedSourceFiles.includes(path))
      : [];
    const coverageGapDetected =
      changedSourceFiles.length > 0 &&
      (input.graph ? unvalidatedSourceFiles.length > 0 : changedTestFiles.length === 0);
    const findings: string[] = [];

    if (coverageGapDetected) {
      findings.push(
        input.graph
          ? `${unvalidatedSourceFiles.length} changed source file(s) lack validating test relationships.`
          : `${changedSourceFiles.length} source file(s) changed without test coverage updates.`
      );
      findings.push("Add or update tests that validate the changed source behavior.");
    } else {
      findings.push("No coverage gaps detected from the changed artifacts.");
    }

    const report: TestCoverageDaemonReport = {
      daemon: this.spec.name,
      outputMode: "report_only",
      changedSourceFiles,
      changedTestFiles,
      validatedSourceFiles: [...new Set(validatedSourceFiles)],
      unvalidatedSourceFiles,
      findings,
      coverageGapDetected
    };

    const turn = await this.loop.recordTurn({
      phase: "VERIFY",
      action: `Run ${this.spec.name} in report_only mode.`,
      changedArtifacts: [],
      commandsRun: [],
      verificationResult: coverageGapDetected ? "partial" : "pass",
      errorSignature: coverageGapDetected ? `${this.spec.name}:test-coverage-gap` : undefined,
      newInformation: findings,
      objectiveDelta: coverageGapDetected ? 0 : 1,
      artifactQualityDelta: coverageGapDetected ? 0 : 1,
      confidenceDelta: coverageGapDetected ? 0 : 1,
      successCriteriaMet: !coverageGapDetected
    });

    return { report, turn };
  }
}
