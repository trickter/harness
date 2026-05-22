import type { HarnessContext } from "../core/LoopController.js";
import type { AutonomousAction, AutonomousWorker, AutonomousWorkerResult } from "./AutonomousTypes.js";

export type ScenarioAgentKind = "bug-finder-fixer" | "data-model-optimization" | "default-worker" | "refactor";

export interface ScenarioAgentRoster {
  defaultWorker: AutonomousWorker;
  refactorWorker?: AutonomousWorker;
  bugFinderFixerWorker?: AutonomousWorker;
  dataModelOptimizationWorker?: AutonomousWorker;
}

export interface ScenarioAgentRoute {
  kind: ScenarioAgentKind;
  phase: HarnessContext["phase"];
  action: string;
  reason: string;
}

interface SelectedWorker {
  kind: ScenarioAgentKind;
  worker: AutonomousWorker;
  reason: string;
}

function textFor(action: AutonomousAction, context: HarnessContext): string {
  return [
    context.contract.goal.name,
    context.contract.goal.objective,
    ...context.contract.successCriteria,
    action.summary,
    action.operation,
    action.prompt
  ]
    .join(" ")
    .toLowerCase();
}

function hasRefactorSignal(value: string): boolean {
  return /\b(refactor|migration|migrate|modernize|restructure)\b/.test(value) || /重构|迁移/.test(value);
}

function hasBugSignal(value: string): boolean {
  return /\b(bug|debug|defect|fix|failure|failing|regression|repair)\b/.test(value) || /修复|错误|失败/.test(value);
}

function hasModelSignal(value: string): boolean {
  return (
    /\b(data|dataset|experiment|metric|model|train|training|evaluate|evaluation|baseline)\b/.test(value) ||
    /数据|模型|实验|指标/.test(value)
  );
}

function normalizedArtifacts(action: AutonomousAction): Set<string> {
  return new Set(action.artifacts.map((artifact) => artifact.replace(/\\/g, "/").toLowerCase()));
}

function overlappingArtifacts(actions: AutonomousAction[]): string[] {
  const seen = new Set<string>();
  const overlaps = new Set<string>();

  for (const action of actions) {
    for (const artifact of normalizedArtifacts(action)) {
      if (seen.has(artifact)) {
        overlaps.add(artifact);
      }

      seen.add(artifact);
    }
  }

  return [...overlaps];
}

export class ScenarioAgentOrchestrator implements AutonomousWorker {
  readonly roster: ScenarioAgentRoster;
  readonly routes: ScenarioAgentRoute[] = [];

  constructor(roster: ScenarioAgentRoster) {
    this.roster = roster;
  }

  async execute(action: AutonomousAction, context: HarnessContext): Promise<AutonomousWorkerResult> {
    const selected = this.select(action, context);

    this.routes.push({
      kind: selected.kind,
      phase: context.phase,
      action: action.summary,
      reason: selected.reason
    });

    return selected.worker.execute(action, context);
  }

  async executeParallel(actions: AutonomousAction[], context: HarnessContext): Promise<AutonomousWorkerResult[]> {
    const overlaps = overlappingArtifacts(actions);

    if (overlaps.length > 0) {
      throw new Error(`parallel agent actions overlap artifacts: ${overlaps.join(", ")}`);
    }

    return Promise.all(actions.map((action) => this.execute(action, context)));
  }

  select(action: AutonomousAction, context: HarnessContext): SelectedWorker {
    const text = textFor(action, context);

    if (context.phase === "REPAIR" && this.roster.bugFinderFixerWorker) {
      return {
        kind: "bug-finder-fixer",
        worker: this.roster.bugFinderFixerWorker,
        reason: "repair phases prefer targeted bug diagnosis and regression fixing"
      };
    }

    if (
      this.roster.dataModelOptimizationWorker &&
      (action.operation === "shell:train" || action.operation === "shell:evaluate" || hasModelSignal(text))
    ) {
      return {
        kind: "data-model-optimization",
        worker: this.roster.dataModelOptimizationWorker,
        reason: "goal or action carries data/model experiment signals"
      };
    }

    if (this.roster.refactorWorker && hasRefactorSignal(text)) {
      return {
        kind: "refactor",
        worker: this.roster.refactorWorker,
        reason: "goal or action carries refactor signals"
      };
    }

    if (this.roster.bugFinderFixerWorker && hasBugSignal(text)) {
      return {
        kind: "bug-finder-fixer",
        worker: this.roster.bugFinderFixerWorker,
        reason: "goal or action carries bug-fix signals"
      };
    }

    return {
      kind: "default-worker",
      worker: this.roster.defaultWorker,
      reason: "no specialised scenario signal matched"
    };
  }
}
