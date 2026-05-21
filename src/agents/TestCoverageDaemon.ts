import type { LoopController, LoopTurnResult } from "../core/LoopController.js";
import { type DaemonSpec } from "./DaemonAgent.js";

export interface TestCoverageDaemonReport {
  daemon: string;
  outputMode: "report_only";
  changedSourceFiles: string[];
  changedTestFiles: string[];
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

  async run(input: { changedArtifacts: string[] }): Promise<TestCoverageDaemonRunResult> {
    const changedSourceFiles = input.changedArtifacts.filter(path => 
      path.startsWith("src/") && !path.endsWith(".test.ts") && !path.endsWith(".spec.ts")
    );
    const changedTestFiles = input.changedArtifacts.filter(path => 
      path.startsWith("test/") || path.endsWith(".test.ts") || path.endsWith(".spec.ts")
    );

    const coverageGapDetected = changedSourceFiles.length > 0 && changedTestFiles.length === 0;
    const findings: string[] = [];

    if (coverageGapDetected) {
      findings.push(`${changedSourceFiles.length} source file(s) changed without test coverage updates.`);
      findings.push("Please add tests under the test/ directory to cover these changes.");
    } else {
      findings.push("No coverage gaps detected from the changed artifacts.");
    }

    const report: TestCoverageDaemonReport = {
      daemon: this.spec.name,
      outputMode: "report_only",
      changedSourceFiles,
      changedTestFiles,
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
