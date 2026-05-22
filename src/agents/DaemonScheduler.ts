import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GoalContract } from "../core/GoalContract.js";
import { LoopController } from "../core/LoopController.js";
import type { HarnessRunPaths } from "../core/RunDirectory.js";
import { ensureRunDirectories } from "../core/RunDirectory.js";
import { JsonlRunLedger, type RunLedgerEntry, type RunLedgerStore } from "../core/RunLedger.js";
import {
  auditChangedArtifacts,
  captureGitArtifactSnapshots,
  changedSinceBaseline,
  matchesArtifactPattern,
  type GitChangedArtifact,
  type ScopeAuditResult
} from "../core/ScopeAudit.js";
import { documentationConsistencyDaemon, type DaemonOutputMode, type DaemonSpec, type DaemonTrigger } from "./DaemonAgent.js";
import { DocumentationDaemonRunner } from "./DocumentationDaemonRunner.js";
import { architectureConsistencyDaemon, ArchitectureConsistencyDaemonRunner } from "./ArchitectureConsistencyDaemon.js";
import { testCoverageDaemon, TestCoverageDaemonRunner } from "./TestCoverageDaemon.js";

export interface DaemonTriggerEvent {
  trigger: DaemonTrigger;
  changedArtifacts?: string[];
  scheduledAt?: string;
}

export interface DaemonPatchSuggestion {
  path: string;
  summary: string;
  patch?: string;
}

export interface DaemonExecutionContext {
  contract: GoalContract;
  cwd: string;
  parentPaths: HarnessRunPaths;
  daemonPaths: DaemonRunPaths;
  ledger: RunLedgerStore;
  loop: LoopController;
  signal: AbortSignal;
}

export interface DaemonExecutionResult<TReport = unknown> {
  report: TReport;
  patchSuggestions?: DaemonPatchSuggestion[];
}

export interface DaemonRegistration<TReport = unknown> {
  spec: DaemonSpec;
  run(event: DaemonTriggerEvent, context: DaemonExecutionContext): Promise<DaemonExecutionResult<TReport>>;
}

export interface DaemonRunPaths {
  runId: string;
  runDir: string;
  ledgerPath: string;
  reportPath: string;
}

export interface DaemonIsolationReport {
  outputMode: DaemonOutputMode;
  valid: boolean;
  changedArtifacts: GitChangedArtifact[];
  patchSuggestions: DaemonPatchSuggestion[];
  violations: string[];
  scopeAudit: ScopeAuditResult;
}

export interface DaemonRunRecord<TReport = unknown> {
  daemon: string;
  parentGoalId: string;
  trigger: DaemonTrigger;
  triggeredAt: string;
  event: DaemonTriggerEvent;
  outputMode: DaemonOutputMode;
  paths: DaemonRunPaths;
  ledgerEntries: number;
  report: TReport;
  isolation: DaemonIsolationReport;
}

export interface DaemonDispatchSkip {
  daemon: string;
  reason: "trigger_not_registered" | "no_relevant_artifacts_changed";
}

export interface DaemonDispatchResult {
  trigger: DaemonTrigger;
  triggeredAt: string;
  runs: DaemonRunRecord[];
  skipped: DaemonDispatchSkip[];
}

export class DaemonBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DaemonBudgetError";
  }
}

function daemonRunId(now: Date): string {
  return `${now.toISOString().replace(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}`;
}

function daemonPaths(parentPaths: HarnessRunPaths, spec: DaemonSpec, runId: string): DaemonRunPaths {
  const runDir = join(parentPaths.daemonsDir, spec.name, runId);

  return {
    runId,
    runDir,
    ledgerPath: join(runDir, "ledger.jsonl"),
    reportPath: join(parentPaths.reportsDir, "daemons", spec.name, `${runId}.json`)
  };
}

function inDaemonScope(path: string, spec: DaemonSpec): boolean {
  return spec.scope.some((pattern) => matchesArtifactPattern(path, pattern));
}

function isolationReport(input: {
  spec: DaemonSpec;
  contract: GoalContract;
  cwd: string;
  changedArtifacts: GitChangedArtifact[];
  patchSuggestions: DaemonPatchSuggestion[];
}): DaemonIsolationReport {
  const violations: string[] = [];
  const changedPaths = input.changedArtifacts.map((artifact) => artifact.path);

  if (input.spec.outputMode === "report_only" && input.patchSuggestions.length > 0) {
    violations.push("report_only daemon emitted patch suggestions.");
  }

  if (input.spec.outputMode !== "auto_patch" && changedPaths.length > 0) {
    violations.push(`${input.spec.outputMode} daemon changed workspace artifacts.`);
  }

  const daemonOutOfScope = changedPaths.filter((path) => !inDaemonScope(path, input.spec));

  if (input.spec.outputMode === "auto_patch" && daemonOutOfScope.length > 0) {
    violations.push(`auto_patch daemon changed artifacts outside daemon scope: ${daemonOutOfScope.join(", ")}.`);
  }

  const scopeAudit = auditChangedArtifacts({
    contract: input.contract,
    cwd: input.cwd,
    changedArtifacts: input.changedArtifacts
  });

  if (input.spec.outputMode === "auto_patch" && !scopeAudit.allowed) {
    violations.push("auto_patch daemon changed artifacts outside the goal contract scope.");
  }

  return {
    outputMode: input.spec.outputMode,
    valid: violations.length === 0,
    changedArtifacts: input.changedArtifacts,
    patchSuggestions: input.patchSuggestions,
    violations,
    scopeAudit
  };
}

function relevantChangedArtifacts(event: DaemonTriggerEvent, spec: DaemonSpec): string[] {
  return (event.changedArtifacts ?? []).filter((path) => inDaemonScope(path, spec));
}

class BudgetedDaemonLedger implements RunLedgerStore {
  readonly ledger: JsonlRunLedger;
  readonly spec: DaemonSpec;
  readonly deadline: number;
  private actions = 0;

  constructor(ledger: JsonlRunLedger, spec: DaemonSpec, startedAt = Date.now()) {
    this.ledger = ledger;
    this.spec = spec;
    this.deadline = startedAt + spec.maxRuntimeMinutes * 60_000;
  }

  async append(entry: RunLedgerEntry): Promise<void> {
    this.assertRuntime();

    if (this.actions >= this.spec.maxActionsPerRun) {
      throw new DaemonBudgetError(`${this.spec.name} exceeded maxActionsPerRun ${this.spec.maxActionsPerRun}`);
    }

    await this.ledger.append(entry);
    this.actions += 1;
  }

  async readAll(): Promise<RunLedgerEntry[]> {
    this.assertRuntime();

    return this.ledger.readAll();
  }

  async window(size: number): Promise<RunLedgerEntry[]> {
    this.assertRuntime();

    return this.ledger.window(size);
  }

  private assertRuntime(): void {
    if (Date.now() > this.deadline) {
      throw new DaemonBudgetError(`${this.spec.name} exceeded maxRuntimeMinutes ${this.spec.maxRuntimeMinutes}`);
    }
  }
}

async function withinRuntimeBudget<T>(spec: DaemonSpec, signal: AbortController, run: () => Promise<T>): Promise<T> {
  const timeoutMs = Math.max(1, spec.maxRuntimeMinutes * 60_000);
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      run(),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          signal.abort();
          reject(new DaemonBudgetError(`${spec.name} exceeded maxRuntimeMinutes ${spec.maxRuntimeMinutes}`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export class DaemonScheduler {
  readonly contract: GoalContract;
  readonly cwd: string;
  readonly paths: HarnessRunPaths;
  readonly registrations: DaemonRegistration[];
  readonly now: () => Date;

  constructor(input: {
    contract: GoalContract;
    cwd: string;
    paths: HarnessRunPaths;
    registrations?: DaemonRegistration[];
    now?: () => Date;
  }) {
    this.contract = input.contract;
    this.cwd = input.cwd;
    this.paths = input.paths;
    this.registrations = input.registrations ?? [
      documentationDaemonRegistration(),
      architectureDaemonRegistration(),
      testCoverageDaemonRegistration()
    ];
    this.now = input.now ?? (() => new Date());
  }

  async dispatch(event: DaemonTriggerEvent): Promise<DaemonDispatchResult> {
    await ensureRunDirectories(this.paths);

    const triggeredAt = this.now().toISOString();
    const runs: DaemonRunRecord[] = [];
    const skipped: DaemonDispatchSkip[] = [];

    for (const registration of this.registrations) {
      if (!registration.spec.trigger.includes(event.trigger)) {
        skipped.push({ daemon: registration.spec.name, reason: "trigger_not_registered" });
        continue;
      }

      if (event.trigger === "on_file_change" && relevantChangedArtifacts(event, registration.spec).length === 0) {
        skipped.push({ daemon: registration.spec.name, reason: "no_relevant_artifacts_changed" });
        continue;
      }

      runs.push(await this.runRegistration(registration, event, triggeredAt));
    }

    return {
      trigger: event.trigger,
      triggeredAt,
      runs,
      skipped
    };
  }

  private async runRegistration(
    registration: DaemonRegistration,
    event: DaemonTriggerEvent,
    triggeredAt: string
  ): Promise<DaemonRunRecord> {
    const paths = daemonPaths(this.paths, registration.spec, daemonRunId(this.now()));
    const rawLedger = new JsonlRunLedger(paths.ledgerPath);
    const ledger = new BudgetedDaemonLedger(rawLedger, registration.spec);
    const loop = new LoopController(this.contract, ledger);
    const signal = new AbortController();

    await Promise.all([mkdir(paths.runDir, { recursive: true }), mkdir(dirname(paths.reportPath), { recursive: true })]);

    const before = await captureGitArtifactSnapshots(this.cwd);
    const result = await withinRuntimeBudget(registration.spec, signal, () =>
      registration.run(event, {
        contract: this.contract,
        cwd: this.cwd,
        parentPaths: this.paths,
        daemonPaths: paths,
        ledger,
        loop,
        signal: signal.signal
      })
    );
    const after = await captureGitArtifactSnapshots(this.cwd);
    const isolation = isolationReport({
      spec: registration.spec,
      contract: this.contract,
      cwd: this.cwd,
      changedArtifacts: changedSinceBaseline({ baseline: before, current: after }),
      patchSuggestions: result.patchSuggestions ?? []
    });
    const record: DaemonRunRecord = {
      daemon: registration.spec.name,
      parentGoalId: this.contract.goal.id,
      trigger: event.trigger,
      triggeredAt,
      event,
      outputMode: registration.spec.outputMode,
      paths,
      ledgerEntries: (await rawLedger.readAll()).length,
      report: result.report,
      isolation
    };

    await writeFile(paths.reportPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

    return record;
  }
}

export function documentationDaemonRegistration(): DaemonRegistration {
  return {
    spec: documentationConsistencyDaemon,
    async run(event, context) {
      const result = await new DocumentationDaemonRunner(documentationConsistencyDaemon, context.loop).run({
        changedArtifacts: event.changedArtifacts ?? []
      });

      return { report: result.report };
    }
  };
}

export function architectureDaemonRegistration(): DaemonRegistration {
  return {
    spec: architectureConsistencyDaemon,
    async run(event, context) {
      const result = await new ArchitectureConsistencyDaemonRunner(architectureConsistencyDaemon, context.loop).run({
        changedArtifacts: event.changedArtifacts ?? []
      });

      return { report: result.report };
    }
  };
}

export function testCoverageDaemonRegistration(): DaemonRegistration {
  return {
    spec: testCoverageDaemon,
    async run(event, context) {
      const result = await new TestCoverageDaemonRunner(testCoverageDaemon, context.loop).run({
        changedArtifacts: event.changedArtifacts ?? []
      });

      return { report: result.report };
    }
  };
}

