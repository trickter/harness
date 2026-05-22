#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { CodexCliAdapter } from "../adapters/CodexCliAdapter.js";
import { ShellAdapter } from "../adapters/ShellAdapter.js";
import { BugFinderFixerAgent } from "../agents/BugFinderFixerAgent.js";
import { documentationConsistencyDaemon } from "../agents/DaemonAgent.js";
import { DaemonScheduler, type DaemonDispatchResult } from "../agents/DaemonScheduler.js";
import { DaemonService } from "../agents/DaemonService.js";
import { DataModelOptimizationAgent } from "../agents/DataModelOptimizationAgent.js";
import { DocumentationDaemonRunner } from "../agents/DocumentationDaemonRunner.js";
import { CodexPlannerAgent } from "../agents/PlannerAgent.js";
import { RefactorAgent } from "../agents/RefactorAgent.js";
import { ScenarioAgentOrchestrator } from "../agents/ScenarioAgentOrchestrator.js";
import { ContractSupervisorAgent } from "../agents/SupervisorAgent.js";
import { ContractVerifierAgent } from "../agents/VerifierAgent.js";
import { CodexWorkerAgent } from "../agents/WorkerAgent.js";
import { AutonomousRun } from "../core/AutonomousRun.js";
import { createGoalContractFromNaturalLanguage, createGoalContractTemplate, loadGoalContract } from "../core/GoalContract.js";
import { LoopController } from "../core/LoopController.js";
import { PermissionPolicy } from "../core/PermissionPolicy.js";
import {
  ensureRunDirectories,
  readRunStatus,
  resumeHarnessRun,
  runPaths,
  startHarnessRun,
  summarizeLedger,
  writeRunStatus
} from "../core/RunDirectory.js";
import { JsonlRunLedger } from "../core/RunLedger.js";
import { recoverHarnessRun } from "../core/RunRecovery.js";
import { captureHarnessSnapshot, changedArtifactsSinceSnapshot } from "../core/RunSnapshot.js";
import { auditChangedArtifacts, auditGitScope, scanGitChangedArtifacts } from "../core/ScopeAudit.js";
import { VerificationRunner } from "../core/VerificationRunner.js";
import { writeTurnDiffArtifact } from "../core/RunObservability.js";
import { PHASES, type Phase } from "../core/StateMachine.js";
import { VERIFICATION_RESULTS, type VerificationResult } from "../core/RunLedger.js";
import { validateLocalSkills, writeSkillValidationReport } from "../skills/SkillValidation.js";

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

function numberFlag(args: string[], flag: string): number | undefined {
  const value = flagValue(args, flag);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be a finite number`);
  }

  return parsed;
}

function requireEnum<T extends readonly string[]>(args: string[], flag: string, values: T): T[number] {
  const value = requireFlag(args, flag);

  if (!values.includes(value)) {
    throw new Error(`${flag} must be one of ${values.join(", ")}`);
  }

  return value;
}

function printUsage(): void {
  console.log(`Usage:
  harness init-contract --name <name> --objective <objective> [--id <id>] [--template] [--out <file>]
  harness start --contract <file> [--run <dir>] [--cwd <dir>]
  harness status --run <dir>
  harness resume --run <dir>
  harness snapshot --run <dir> --name <name> [--cwd <dir>]
  harness diff --run <dir> [--cwd <dir>]
  harness audit --run <dir> [--cwd <dir>] [--since <snapshot>]
  harness recover --run <dir> [--cwd <dir>] [--from <snapshot>] [--apply]
  harness skills validate [--root <dir>] [--report <file>]
  harness turn --run <dir> --phase <phase> --action <text> --verification <result> [--cwd <dir>] [--changed <path>] [--command <cmd>] [--info <text>] [--error-signature <sig>] [--failure-count <n>]
  harness verify --run <dir> [--cwd <dir>]
  harness run --dry-policy --contract <file> --operation <operation> [--artifact <path>] [--destructive] [--external-network] [--secret-access] [--approved]
  harness codex-run --contract <file> [--ledger <ledger.jsonl>] [--cwd <dir>] [--model <model>] [--codex-bin <path>]
  harness daemon documentation --contract <file> --changed <path> [--changed <path>...] [--ledger <ledger.jsonl>]
  harness daemon dispatch --run <dir> --trigger <on_goal_finished|on_file_change|scheduled> [--cwd <dir>] [--changed <path>...] [--scheduled-at <iso>]
  harness daemon serve --run <dir> [--cwd <dir>] [--interval-ms <n>] [--no-watch]
  harness ledger inspect <ledger.jsonl>`);
}

async function initContract(args: string[]): Promise<void> {
  const input = {
    id: flagValue(args, "--id"),
    name: requireFlag(args, "--name"),
    objective: requireFlag(args, "--objective")
  };
  const contract = hasFlag(args, "--template")
    ? createGoalContractTemplate(input)
    : createGoalContractFromNaturalLanguage(input);
  const output = stringifyYaml(contract);
  const outputPath = flagValue(args, "--out");

  if (outputPath) {
    await writeFile(outputPath, output, "utf8");
    console.log(`wrote ${outputPath}`);
    return;
  }

  process.stdout.write(output);
}

async function resolveContractAndLedger(args: string[]): Promise<{
  contractPath: string;
  ledgerPath: string;
  runDir?: string;
}> {
  const runDir = flagValue(args, "--run");

  if (runDir) {
    const paths = runPaths(runDir);
    await ensureRunDirectories(paths);

    return {
      contractPath: paths.contractPath,
      ledgerPath: paths.ledgerPath,
      runDir: paths.runDir
    };
  }

  const contractPath = requireFlag(args, "--contract");
  const contract = await loadGoalContract(contractPath);

  return {
    contractPath,
    ledgerPath: flagValue(args, "--ledger") ?? join(".harness", "runs", contract.goal.id, "ledger.jsonl")
  };
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
  const resolved = await resolveContractAndLedger(args);
  const contract = await loadGoalContract(resolved.contractPath);
  const ledger = new JsonlRunLedger(resolved.ledgerPath);
  const permissions = new PermissionPolicy(contract);
  const loop = new LoopController(contract, ledger, { permissions });
  const cwd = flagValue(args, "--cwd") ?? process.cwd();
  const shell = new ShellAdapter(permissions, { workspaceRoot: cwd });
  const codex = new CodexCliAdapter({
    binary: flagValue(args, "--codex-bin"),
    model: flagValue(args, "--model")
  });
  const verifier = new ContractVerifierAgent(new VerificationRunner(contract, loop, shell));
  const worker = new ScenarioAgentOrchestrator({
    defaultWorker: new CodexWorkerAgent(codex, cwd),
    refactorWorker: new RefactorAgent(codex, cwd),
    bugFinderFixerWorker: new BugFinderFixerAgent(codex, cwd),
    dataModelOptimizationWorker: new DataModelOptimizationAgent(codex, cwd)
  });
  const runner = new AutonomousRun(
    contract,
    loop,
    new CodexPlannerAgent(codex, cwd),
    new ContractSupervisorAgent(),
    worker,
    verifier
  );
  const result = await runner.run({ cwd, paths: resolved.runDir ? runPaths(resolved.runDir) : undefined });
  const latest = result.ledger.at(-1);

  console.log(
    JSON.stringify(
      {
        goalId: contract.goal.id,
        ledger: resolved.ledgerPath,
        runDir: resolved.runDir,
        phase: result.phase,
        iterations: result.ledger.length,
        plans: result.plans.length,
        workerActions: result.workerResults.length,
        verificationRuns: result.verificationRuns.length,
        latestAction: latest?.action,
        latestVerificationResult: latest?.verificationResult
      },
      null,
      2
    )
  );

  if (result.phase !== "FINISH") {
    process.exitCode = 1;
  }
}

async function recordTurn(args: string[]): Promise<void> {
  const resolved = await resolveContractAndLedger(args);
  const contract = await loadGoalContract(resolved.contractPath);
  const ledger = new JsonlRunLedger(resolved.ledgerPath);
  const permissions = new PermissionPolicy(contract);
  const loop = new LoopController(contract, ledger, { permissions });
  const changedArtifacts = flagValues(args, "--changed");
  const cwd = flagValue(args, "--cwd") ?? process.cwd();
  const result = await loop.recordTurn({
    phase: requireEnum(args, "--phase", PHASES) as Phase,
    action: requireFlag(args, "--action"),
    changedArtifacts,
    commandsRun: flagValues(args, "--command"),
    verificationResult: requireEnum(args, "--verification", VERIFICATION_RESULTS) as VerificationResult,
    errorSignature: flagValue(args, "--error-signature"),
    currentHypothesis: flagValue(args, "--hypothesis"),
    newInformation: flagValues(args, "--info"),
    objectiveDelta: numberFlag(args, "--objective-delta"),
    failureCount: numberFlag(args, "--failure-count"),
    failureCountDelta: numberFlag(args, "--failure-count-delta"),
    artifactQualityDelta: numberFlag(args, "--artifact-quality-delta"),
    scopeDriftScore: numberFlag(args, "--scope-drift-score"),
    confidenceDelta: numberFlag(args, "--confidence-delta"),
    selectedStrategyReady: hasFlag(args, "--selected-strategy-ready"),
    alternativeStrategySelected: hasFlag(args, "--alternative-strategy-selected"),
    actionCompleted: hasFlag(args, "--action-completed"),
    repairCompleted: hasFlag(args, "--repair-completed"),
    successCriteriaMet: hasFlag(args, "--success-criteria-met"),
    permissionRequired: hasFlag(args, "--permission-required"),
    humanApproved: hasFlag(args, "--human-approved"),
    humanDenied: hasFlag(args, "--human-denied")
  });
  const paths = resolved.runDir ? runPaths(resolved.runDir) : undefined;
  const turnDiff = paths ? await writeTurnDiffArtifact({ paths, cwd, entry: result.entry }) : undefined;
  const status = paths ? await writeRunStatus(paths) : undefined;
  const statusPath = paths?.statusPath;
  const daemonDispatch =
    paths && changedArtifacts.length > 0
      ? await dispatchRunDaemons({
          paths,
          cwd,
          trigger: "on_file_change",
          changedArtifacts
        })
      : undefined;

  console.log(
    JSON.stringify(
      {
        goalId: contract.goal.id,
        iteration: result.entry.iteration,
        phase: result.entry.phase,
        nextPhase: result.entry.nextPhase,
        progressSignal: result.entry.progressSignal,
        transitionReason: result.transition.reason,
        stop: result.stopDecision.stop,
        stopReason: result.stopDecision.reason,
        runDir: resolved.runDir,
        statusPath: status ? statusPath : undefined,
        turnDiff: turnDiff?.path,
        daemonDispatch
      },
      null,
      2
    )
  );

  if (result.entry.nextPhase === "ABORT" || result.entry.nextPhase === "NEED_HUMAN") {
    process.exitCode = 1;
  }
}

async function verifyContract(args: string[]): Promise<void> {
  const resolved = await resolveContractAndLedger(args);
  const contract = await loadGoalContract(resolved.contractPath);
  const ledger = new JsonlRunLedger(resolved.ledgerPath);
  const permissions = new PermissionPolicy(contract);
  const loop = new LoopController(contract, ledger, { permissions });
  const cwd = flagValue(args, "--cwd") ?? process.cwd();
  const shell = new ShellAdapter(permissions, { workspaceRoot: cwd });
  const paths = resolved.runDir ? runPaths(resolved.runDir) : undefined;
  const result = await new VerificationRunner(contract, loop, shell).run({ cwd, paths });
  const turnDiff = paths ? await writeTurnDiffArtifact({ paths, cwd, entry: result.turn.entry }) : undefined;
  const status = paths ? await writeRunStatus(paths) : undefined;
  const statusPath = paths?.statusPath;
  const healthySnapshot =
    paths && result.verificationResult === "pass"
      ? await captureHarnessSnapshot({
          paths,
          cwd,
          name: "healthy",
          ledgerIteration: result.turn.entry.iteration,
          verificationResult: result.verificationResult
        })
      : undefined;
  const failedCommands = result.commands.filter((command) => command.exitCode !== 0);
  const daemonDispatch =
    paths && result.turn.transition.to === "FINISH"
      ? await dispatchRunDaemons({
          paths,
          cwd,
          trigger: "on_goal_finished",
          changedArtifacts: (
            await changedArtifactsSinceSnapshot({
              paths,
              cwd,
              since: "baseline"
            })
          ).map((artifact) => artifact.path)
        })
      : undefined;

  console.log(
    JSON.stringify(
      {
        goalId: contract.goal.id,
        ledger: resolved.ledgerPath,
        runDir: resolved.runDir,
        statusPath: status ? statusPath : undefined,
        turnDiff: turnDiff?.path,
        healthySnapshot: healthySnapshot?.name,
        verificationResult: result.verificationResult,
        nextPhase: result.turn.transition.to,
        daemonDispatch,
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

async function runDocumentationDaemon(args: string[]): Promise<void> {
  const resolved = await resolveContractAndLedger(args);
  const contract = await loadGoalContract(resolved.contractPath);
  const changedArtifacts = flagValues(args, "--changed");

  if (changedArtifacts.length === 0) {
    throw new Error("documentation daemon requires at least one --changed path");
  }

  const permissions = new PermissionPolicy(contract);
  const loop = new LoopController(contract, new JsonlRunLedger(resolved.ledgerPath), { permissions });
  const runner = new DocumentationDaemonRunner(documentationConsistencyDaemon, loop);
  const result = await runner.run({ changedArtifacts });
  const status = resolved.runDir ? await writeRunStatus(runPaths(resolved.runDir)) : undefined;
  const statusPath = resolved.runDir ? runPaths(resolved.runDir).statusPath : undefined;

  console.log(
    JSON.stringify(
      {
        ledger: resolved.ledgerPath,
        runDir: resolved.runDir,
        statusPath: status ? statusPath : undefined,
        nextPhase: result.turn.transition.to,
        ...result.report
      },
      null,
      2
    )
  );

  if (result.report.needsDocumentationReview) {
    process.exitCode = 1;
  }
}

const DAEMON_TRIGGERS = ["on_goal_finished", "on_file_change", "scheduled"] as const;

async function dispatchRunDaemons(input: {
  paths: ReturnType<typeof runPaths>;
  cwd: string;
  trigger: (typeof DAEMON_TRIGGERS)[number];
  changedArtifacts?: string[];
  scheduledAt?: string;
}): Promise<DaemonDispatchResult> {
  const contract = await loadGoalContract(input.paths.contractPath);

  return new DaemonScheduler({
    contract,
    cwd: input.cwd,
    paths: input.paths
  }).dispatch({
    trigger: input.trigger,
    changedArtifacts: input.changedArtifacts,
    scheduledAt: input.scheduledAt
  });
}

async function dispatchDaemons(args: string[]): Promise<void> {
  const paths = runPaths(requireFlag(args, "--run"));
  const cwd = flagValue(args, "--cwd") ?? process.cwd();
  const changedArtifacts = flagValues(args, "--changed");
  const trigger = requireEnum(args, "--trigger", DAEMON_TRIGGERS);
  const dispatch = await dispatchRunDaemons({
    paths,
    cwd,
    trigger,
    changedArtifacts:
      changedArtifacts.length > 0 || trigger === "scheduled"
        ? changedArtifacts
        : (await scanGitChangedArtifacts(cwd)).map((artifact) => artifact.path),
    scheduledAt: flagValue(args, "--scheduled-at")
  });

  console.log(JSON.stringify(dispatch, null, 2));

  if (dispatch.runs.some((run) => !run.isolation.valid)) {
    process.exitCode = 1;
  }
}

async function serveDaemons(args: string[]): Promise<void> {
  const paths = runPaths(requireFlag(args, "--run"));
  const cwd = flagValue(args, "--cwd") ?? process.cwd();
  const contract = await loadGoalContract(paths.contractPath);
  const intervalMs = numberFlag(args, "--interval-ms") ?? 60_000;
  const service = new DaemonService({
    dispatcher: new DaemonScheduler({ contract, cwd, paths }),
    cwd,
    scheduledIntervalMs: intervalMs,
    watchFileChanges: !hasFlag(args, "--no-watch")
  });

  await service.start();
  console.log(JSON.stringify({ cwd, runDir: paths.runDir, intervalMs, ...service.status() }, null, 2));

  await new Promise<void>((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  console.log(JSON.stringify(await service.stop(), null, 2));
}

async function startRun(args: string[]): Promise<void> {
  const result = await startHarnessRun({
    contractPath: requireFlag(args, "--contract"),
    runDir: flagValue(args, "--run")
  });
  const cwd = flagValue(args, "--cwd") ?? process.cwd();
  const baseline = await captureHarnessSnapshot({
    paths: result.paths,
    cwd,
    name: "baseline"
  });

  console.log(
    JSON.stringify(
      {
        runDir: result.paths.runDir,
        contract: result.paths.contractPath,
        ledger: result.paths.ledgerPath,
        status: result.paths.statusPath,
        verificationDir: result.paths.verificationDir,
        reportsDir: result.paths.reportsDir,
        snapshotsDir: result.paths.snapshotsDir,
        daemonsDir: result.paths.daemonsDir,
        baselineSnapshot: "baseline",
        baselineArtifacts: baseline.artifacts.length,
        phase: result.status.phase
      },
      null,
      2
    )
  );
}

async function statusRun(args: string[]): Promise<void> {
  const paths = runPaths(requireFlag(args, "--run"));
  const status = await readRunStatus(paths);
  const entries = await new JsonlRunLedger(paths.ledgerPath).readAll();

  console.log(JSON.stringify({ ...status, ...summarizeLedger(entries) }, null, 2));
}

async function resumeRun(args: string[]): Promise<void> {
  const resume = await resumeHarnessRun(runPaths(requireFlag(args, "--run")));

  console.log(JSON.stringify(resume, null, 2));
}

async function snapshotRun(args: string[]): Promise<void> {
  const paths = runPaths(requireFlag(args, "--run"));
  await ensureRunDirectories(paths);

  const snapshot = await captureHarnessSnapshot({
    paths,
    cwd: flagValue(args, "--cwd") ?? process.cwd(),
    name: requireFlag(args, "--name")
  });

  console.log(
    JSON.stringify(
      {
        runDir: paths.runDir,
        snapshot: snapshot.name,
        path: join(paths.snapshotsDir, `${snapshot.name}.json`),
        cwd: snapshot.cwd,
        artifacts: snapshot.artifacts.length
      },
      null,
      2
    )
  );
}

async function diffRun(args: string[]): Promise<void> {
  const runDir = requireFlag(args, "--run");
  const cwd = flagValue(args, "--cwd") ?? process.cwd();
  const changedArtifacts = await scanGitChangedArtifacts(cwd);

  console.log(
    JSON.stringify(
      {
        runDir: runPaths(runDir).runDir,
        cwd,
        changedArtifacts
      },
      null,
      2
    )
  );
}

async function auditRun(args: string[]): Promise<void> {
  const paths = runPaths(requireFlag(args, "--run"));
  await ensureRunDirectories(paths);

  const cwd = flagValue(args, "--cwd") ?? process.cwd();
  const contract = await loadGoalContract(paths.contractPath);
  const since = flagValue(args, "--since");
  const finalAudit = since
    ? auditChangedArtifacts({
        contract,
        cwd,
        changedArtifacts: await changedArtifactsSinceSnapshot({ paths, cwd, since })
      })
    : await auditGitScope({ contract, cwd });
  const reportPath = join(paths.reportsDir, "scope-audit.json");

  await writeFile(reportPath, `${JSON.stringify({ since, ...finalAudit }, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        runDir: paths.runDir,
        report: reportPath,
        since,
        ...finalAudit
      },
      null,
      2
    )
  );

  if (!finalAudit.allowed) {
    process.exitCode = 1;
  }
}

async function recoverRun(args: string[]): Promise<void> {
  const paths = runPaths(requireFlag(args, "--run"));
  await ensureRunDirectories(paths);

  const contract = await loadGoalContract(paths.contractPath);
  const ledger = await new JsonlRunLedger(paths.ledgerPath).readAll();
  const plan = await recoverHarnessRun({
    paths,
    contract,
    ledger,
    cwd: flagValue(args, "--cwd") ?? process.cwd(),
    from: flagValue(args, "--from"),
    apply: hasFlag(args, "--apply")
  });

  console.log(JSON.stringify(plan, null, 2));

  if (plan.apply && !plan.scopeAudit.allowed) {
    process.exitCode = 1;
  }
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
        phases: summarizeLedger(entries).phases,
        verification: summarizeLedger(entries).verification
      },
      null,
      2
    )
  );
}

async function validateSkills(args: string[]): Promise<void> {
  const root = flagValue(args, "--root") ?? join(process.cwd(), "skills");
  const report = await validateLocalSkills(root);
  const reportPath = flagValue(args, "--report");

  if (reportPath) {
    await writeSkillValidationReport(reportPath, report);
  }

  console.log(JSON.stringify({ report: reportPath, ...report }, null, 2));

  if (!report.valid) {
    process.exitCode = 1;
  }
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

  if (command === "start") {
    await startRun([subcommand, ...rest].filter((value): value is string => Boolean(value)));
    return;
  }

  if (command === "status") {
    await statusRun([subcommand, ...rest].filter((value): value is string => Boolean(value)));
    return;
  }

  if (command === "resume") {
    await resumeRun([subcommand, ...rest].filter((value): value is string => Boolean(value)));
    return;
  }

  if (command === "snapshot") {
    await snapshotRun([subcommand, ...rest].filter((value): value is string => Boolean(value)));
    return;
  }

  if (command === "diff") {
    await diffRun([subcommand, ...rest].filter((value): value is string => Boolean(value)));
    return;
  }

  if (command === "audit") {
    await auditRun([subcommand, ...rest].filter((value): value is string => Boolean(value)));
    return;
  }

  if (command === "recover") {
    await recoverRun([subcommand, ...rest].filter((value): value is string => Boolean(value)));
    return;
  }

  if (command === "skills" && subcommand === "validate") {
    await validateSkills(rest);
    return;
  }

  if (command === "run") {
    printUsage();
    console.error("harness run is reserved for Codex /goal skill-driven operation; use harness turn/verify, or harness codex-run for the experimental Codex subprocess runner.");
    process.exitCode = 1;
    return;
  }

  if (command === "codex-run") {
    await runContract([subcommand, ...rest].filter((value): value is string => Boolean(value)));
    return;
  }

  if (command === "turn") {
    await recordTurn([subcommand, ...rest].filter((value): value is string => Boolean(value)));
    return;
  }

  if (command === "verify") {
    await verifyContract([subcommand, ...rest].filter((value): value is string => Boolean(value)));
    return;
  }

  if (command === "daemon" && subcommand === "documentation") {
    await runDocumentationDaemon(rest);
    return;
  }

  if (command === "daemon" && subcommand === "dispatch") {
    await dispatchDaemons(rest);
    return;
  }

  if (command === "daemon" && subcommand === "serve") {
    await serveDaemons(rest);
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
