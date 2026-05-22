import type { VerificationRunResult, VerificationRunner } from "../core/VerificationRunner.js";
import type { HarnessRunPaths } from "../core/RunDirectory.js";
import type { AutonomousVerifier } from "./AutonomousTypes.js";

export class ContractVerifierAgent implements AutonomousVerifier {
  readonly runner: VerificationRunner;

  constructor(runner: VerificationRunner) {
    this.runner = runner;
  }

  async verify(options: { cwd?: string; paths?: HarnessRunPaths } = {}): Promise<VerificationRunResult> {
    return this.runner.run(options);
  }
}
