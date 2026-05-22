import assert from "node:assert/strict";
import test from "node:test";
import { DaemonService } from "../src/agents/DaemonService.js";
import type { DaemonTriggerEvent } from "../src/agents/DaemonScheduler.js";

test("daemon service dispatches file, scheduled, and goal-finished lifecycle triggers", async () => {
  const events: DaemonTriggerEvent[] = [];
  let onChange: ((path: string) => void) | undefined;
  let onInterval: (() => void) | undefined;
  let watcherClosed = false;
  let intervalCleared = false;
  const service = new DaemonService({
    cwd: "workspace",
    dispatcher: {
      async dispatch(event) {
        events.push(event);

        return {
          trigger: event.trigger,
          triggeredAt: "2026-05-22T00:00:00.000Z",
          runs: [],
          skipped: []
        };
      }
    },
    now: () => new Date("2026-05-22T00:00:00.000Z"),
    watchFactory(_cwd, callback) {
      onChange = callback;

      return {
        close() {
          watcherClosed = true;
        }
      };
    },
    setIntervalFn(callback) {
      onInterval = callback;

      return {} as NodeJS.Timeout;
    },
    clearIntervalFn() {
      intervalCleared = true;
    }
  });

  const started = await service.start();

  onChange?.("src\\feature.ts");
  onInterval?.();
  await service.goalFinished(["docs\\README.md"]);
  await service.flush();
  const stopped = await service.stop();

  assert.equal(started.running, true);
  assert.deepEqual(
    events.map((event) => event.trigger),
    ["on_file_change", "scheduled", "on_goal_finished"]
  );
  assert.deepEqual(events[0]?.changedArtifacts, ["src/feature.ts"]);
  assert.equal(events[1]?.scheduledAt, "2026-05-22T00:00:00.000Z");
  assert.deepEqual(events[2]?.changedArtifacts, ["docs/README.md"]);
  assert.equal(stopped.running, false);
  assert.equal(stopped.dispatches, 3);
  assert.equal(watcherClosed, true);
  assert.equal(intervalCleared, true);
});
