import type { ShellAdapter, ShellRunResult } from "../adapters/ShellAdapter.js";
import type { GoalContract } from "./GoalContract.js";
import { LoopController, type LoopTurnResult } from "./LoopController.js";
import type { VerificationResult } from "./RunLedger.js";
import { VerificationParser, type ParsedVerificationOutput } from "./VerificationParser.js";

export interface VerificationCommandResult extends ShellRunResult {
  command: string;
  operation: string;
  parsed: ParsedVerificationOutput;
}

export interface VerificationRunResult {
  commands: VerificationCommandResult[];
  turn: LoopTurnResult;
  verificationResult: VerificationResult;
}

function inferVerificationOperation(command: string): string {
  const normalized = command.trim().toLowerCase();

  if (/\b(test|jest|vitest|pytest|cargo test|go test)\b/.test(normalized)) {
    return "shell:test";
  }

  if (/\b(tsc|typecheck|check)\b/.test(normalized)) {
    return "shell:typecheck";
  }

  if (/\b(data-check|check-csv|quality)\b/.test(normalized)) {
    return "shell:data-check";
  }

  return "shell:verify";
}

function errorSignatureFor(results: VerificationCommandResult[]): string | undefined {
  const failed = results.find((result) => result.exitCode !== 0);

  if (!failed) {
    return undefined;
  }

  return failed.parsed.errorSignature ?? `${failed.operation}:${failed.command}:exit-${failed.exitCode}`;
}

function verificationResultFor(results: VerificationCommandResult[]): VerificationResult {
  if (results.length === 0) {
    return "skipped";
  }

  return results.every((result) => result.exitCode === 0) ? "pass" : "fail";
}

export class VerificationRunner {
  readonly contract: GoalContract;
  readonly loop: LoopController;
  readonly parser: VerificationParser;
  readonly shell: ShellAdapter;

  constructor(contract: GoalContract, loop: LoopController, shell: ShellAdapter, parser = new VerificationParser()) {
    this.contract = contract;
    this.loop = loop;
    this.parser = parser;
    this.shell = shell;
  }

  async run(options: { cwd?: string } = {}): Promise<VerificationRunResult> {
    const commands: VerificationCommandResult[] = [];

    for (const command of this.contract.verification.commands) {
      const operation = inferVerificationOperation(command);
      const result = await this.shell.runLine({
        commandLine: command,
        cwd: options.cwd,
        operation
      });
      const parsed = this.parser.parse({ command, operation, ...result });

      commands.push({ command, operation, parsed, ...result });
    }

    const verificationResult = verificationResultFor(commands);
    const failedCommandCount = commands.filter((command) => command.exitCode !== 0).length;
    const passedCount = commands.length - failedCommandCount;
    const failureCount = commands.reduce((count, command) => count + command.parsed.failureCount, 0);
    const turn = await this.loop.recordTurn({
      phase: "VERIFY",
      action: commands.length
        ? `Run ${commands.length} verification command(s).`
        : "No verification commands configured.",
      changedArtifacts: [],
      commandsRun: commands.map((command) => command.command),
      verificationResult,
      errorSignature: errorSignatureFor(commands),
      newInformation: commands.length
        ? [
            `${passedCount} verification command(s) passed; ${failedCommandCount} failed.`,
            ...commands.filter((command) => command.parsed.failureCount > 0).map((command) => command.parsed.summary)
          ]
        : ["Goal contract has no verification commands."],
      objectiveDelta: verificationResult === "pass" ? 1 : 0,
      failureCount,
      confidenceDelta: verificationResult === "pass" ? 1 : 0,
      successCriteriaMet: verificationResult === "pass"
    });

    return { commands, turn, verificationResult };
  }
}
