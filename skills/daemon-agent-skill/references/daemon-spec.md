# Daemon Spec

```yaml
daemon:
  name: documentation-consistency-daemon
  trigger: [on_goal_finished, on_file_change]
  scope: [docs/**, README*, src/**]
  maxRuntimeMinutes: 10
  maxActionsPerRun: 3
  outputMode: report_only
  stopConditions:
    - no_relevant_artifacts_changed
    - max_actions_reached
    - supervisor_denied
```
