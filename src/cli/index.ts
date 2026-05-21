#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { ShellAdapter } from "../adapters/ShellAdapter.js";
import { createGoalContractTemplate, loadGoalContract } from "../core/GoalContract.js";
import { LoopController } from "../core/LoopController.js";
import { PermissionPolicy } from "../core/PermissionPolicy.js";
import { JsonlRunLedger, type RunLedgerEntry } from "../core/RunLedger.js";
import { VerificationRunner } from "../core/VerificationRunner.js";

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function flagValues(args: string[], flag: string): string[] {
  const values: string[] = [];

  args.forEach((arg, index) => {
    const value = args[index + 1];

    if (arg === flag && value) {
      values.push(value);
    }
  });

  return values;
}

function requireFlag(args: string[], flag: string): string {
  const value = flagValue(args, flag);

  if (!value) {
    throw new Error(`missing required ${flag} value`);
  }

  return value;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function printUsage(): void {
  console.log(`Usage:
  harness init-contract --name <name> --objective <objective> [--id <id>] [--out <file>]
  harness run --contract <file> [--ledger <ledger.jsonl>] [--cwd <dir>]
  harness run --dry-policy --contract <file> --operation <operation> [--artifact <path>] [--destructive] [--external-network] [--secret-access] [--approved]
  harness ledger inspect <ledger.jsonl>`);
}

async function initContract(args: string[]): Promise<void> {
  const contract = createGoalContractTemplate({
    id: flagValue(args, "--id"),
    name: requireFlag(args, "--name"),
    objective: requireFlag(args, "--objective")
  });
  const output = stringifyYaml(contract);
  const outputPath = flagValue(args, "--out");

  if (outputPath) {
    await writeFile(outputPath, output, "utf8");
    console.log(`wrote ${outputPath}`);
    return;
  }

  process.stdout.write(output);
}

async function dryPolicy(args: string[]): Promise<void> {
  const contract = await loadGoalContract(requireFlag(args, "--contract"));
  const decision = new PermissionPolicy(contract).evaluate({
    operation: requireFlag(args, "--operation"),
    artifacts: flagValues(args, "--artifact"),
    destructive: hasFlag(args, "--destructive"),
    externalNetwork: hasFlag(args, "--external-network"),
    secretAccess: hasFlag(args, "--secret-access"),
    approvalGranted: hasFlag(args, "--approved")
  });

  console.log(JSON.stringify(decision, null, 2));

  if (!decision.allowed) {
    process.exitCode = 2;
  }
}

async function runContract(args: string[]): Promise<void> {
  const contract = await loadGoalContract(requireFlag(args, "--contract"));
  const ledgerPath = flagValue(args, "--ledger") ?? join(".harness", "runs", contract.goal.id, "ledger.jsonl");
  const ledger = new JsonlRunLedger(ledgerPath);
  const permissions = new PermissionPolicy(contract);
  const loop = new LoopController(contract, ledger, { permissions });
  const shell = new ShellAdapter(permissions);
  const runner = new VerificationRunner(contract, loop, shell);
  const result = await runner.run({ cwd: flagValue(args, "--cwd") });
  const failedCommands = result.commands.filter((command) => command.exitCode !== 0);

  console.log(
    JSON.stringify(
      {
        goalId: contract.goal.id,
        ledger: ledgerPath,
        verificationResult: result.verificationResult,
        nextPhase: result.turn.transition.to,
        passedCommands: result.commands.length - failedCommands.length,
        failedCommands: failedCommands.map((command) => ({
          command: command.command,
          operation: command.operation,
          exitCode: command.exitCode,
          failureCount: command.parsed.failureCount,
          errorSignature: command.parsed.errorSignature
        }))
      },
      null,
      2
    )
  );

  if (result.verificationResult !== "pass") {
    process.exitCode = 1;
  }
}

function countBy(entries: RunLedgerEntry[], key: "phase" | "verificationResult"): Record<string, number> {
  return entries.reduce<Record<string, number>>((counts, entry) => {
    const value = entry[key];
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

async function inspectLedger(path: string): Promise<void> {
  const entries = await new JsonlRunLedger(path).readAll();
  const latest = entries.at(-1);

  console.log(
    JSON.stringify(
      {
        entries: entries.length,
        goalId: latest?.goalId,
        latestPhase: latest?.phase,
        nextPhase: latest?.nextPhase,
        phases: countBy(entries, "phase"),
        verification: countBy(entries, "verificationResult")
      },
      null,
      2
    )
  );
}

async function main(args: string[]): Promise<void> {
  const [command, subcommand, ...rest] = args;

  if (!command || hasFlag(args, "--help")) {
    printUsage();
    return;
  }

  if (command === "init-contract") {
    await initContract([subcommand, ...rest].filter((value): value is string => Boolean(value)));
    return;
  }

  if (command === "run" && subcommand === "--dry-policy") {
    await dryPolicy(rest);
    return;
  }

  if (command === "run") {
    await runContract([subcommand, ...rest].filter((value): value is string => Boolean(value)));
    return;
  }

  if (command === "ledger" && subcommand === "inspect") {
    const path = rest[0];

    if (!path) {
      throw new Error("ledger inspect requires a JSONL path");
    }

    await inspectLedger(path);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
