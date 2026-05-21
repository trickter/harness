export type DaemonOutputMode = "report_only" | "suggest_patch" | "auto_patch";

export interface DaemonSpec {
  name: string;
  trigger: string[];
  scope: string[];
  maxRuntimeMinutes: number;
  maxActionsPerRun: number;
  outputMode: DaemonOutputMode;
  stopConditions: string[];
}

export const documentationConsistencyDaemon: DaemonSpec = {
  name: "documentation-consistency-daemon",
  trigger: ["on_goal_finished", "on_file_change"],
  scope: ["docs/**", "README*", "src/**"],
  maxRuntimeMinutes: 10,
  maxActionsPerRun: 3,
  outputMode: "report_only",
  stopConditions: ["no_relevant_artifacts_changed", "max_actions_reached", "supervisor_denied"]
};
