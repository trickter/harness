import type { ArtifactGraph } from "../artifacts/ArtifactGraph.js";
import type { GoalContract } from "../core/GoalContract.js";
import type { PermissionPolicy } from "../core/PermissionPolicy.js";
import type { Phase } from "../core/StateMachine.js";
import type { RunLedgerEntry } from "../core/RunLedger.js";

export interface SkillContext {
  contract: GoalContract;
  phase: Phase;
  ledger: RunLedgerEntry[];
  artifacts: ArtifactGraph;
  permissions: PermissionPolicy;
}

export interface Skill<I = unknown, O = unknown> {
  name: string;
  run(input: I, context: SkillContext): Promise<O>;
}
