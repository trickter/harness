import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import type { DaemonDispatchResult, DaemonTriggerEvent } from "./DaemonScheduler.js";

export interface DaemonDispatcher {
  dispatch(event: DaemonTriggerEvent): Promise<DaemonDispatchResult>;
}

export interface DaemonFileWatcher {
  close(): void;
}

export interface DaemonServiceStatus {
  running: boolean;
  startedAt?: string;
  stoppedAt?: string;
  dispatches: number;
  errors: string[];
}

export interface DaemonServiceOptions {
  dispatcher: DaemonDispatcher;
  cwd: string;
  scheduledIntervalMs?: number;
  watchFileChanges?: boolean;
  now?: () => Date;
  watchFactory?: (cwd: string, onChange: (path: string) => void) => DaemonFileWatcher;
  setIntervalFn?: (callback: () => void, intervalMs: number) => NodeJS.Timeout;
  clearIntervalFn?: (timer: NodeJS.Timeout) => void;
}

function normalizeChangedPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function defaultWatchFactory(cwd: string, onChange: (path: string) => void): FSWatcher {
  return watch(cwd, { recursive: true }, (_event, fileName) => {
    if (fileName) {
      onChange(normalizeChangedPath(fileName.toString()));
    }
  });
}

export class DaemonService {
  readonly dispatcher: DaemonDispatcher;
  readonly cwd: string;
  readonly scheduledIntervalMs: number;
  readonly watchFileChanges: boolean;
  readonly now: () => Date;
  readonly watchFactory: (cwd: string, onChange: (path: string) => void) => DaemonFileWatcher;
  readonly setIntervalFn: (callback: () => void, intervalMs: number) => NodeJS.Timeout;
  readonly clearIntervalFn: (timer: NodeJS.Timeout) => void;
  readonly dispatches: DaemonDispatchResult[] = [];
  readonly errors: string[] = [];

  private watcher?: DaemonFileWatcher;
  private timer?: NodeJS.Timeout;
  private pending: Promise<void> = Promise.resolve();
  private startedAt?: string;
  private stoppedAt?: string;

  constructor(options: DaemonServiceOptions) {
    this.dispatcher = options.dispatcher;
    this.cwd = options.cwd;
    this.scheduledIntervalMs = options.scheduledIntervalMs ?? 60_000;
    this.watchFileChanges = options.watchFileChanges ?? true;
    this.now = options.now ?? (() => new Date());
    this.watchFactory = options.watchFactory ?? defaultWatchFactory;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  }

  async start(): Promise<DaemonServiceStatus> {
    if (this.startedAt && !this.stoppedAt) {
      return this.status();
    }

    this.startedAt = this.now().toISOString();
    this.stoppedAt = undefined;

    if (this.watchFileChanges) {
      this.watcher = this.watchFactory(this.cwd, (path) => {
        void this.enqueue({
          trigger: "on_file_change",
          changedArtifacts: [normalizeChangedPath(path)]
        }).catch(() => undefined);
      });
    }

    if (this.scheduledIntervalMs > 0) {
      this.timer = this.setIntervalFn(() => {
        void this.enqueue({
          trigger: "scheduled",
          scheduledAt: this.now().toISOString()
        }).catch(() => undefined);
      }, this.scheduledIntervalMs);
    }

    return this.status();
  }

  async goalFinished(changedArtifacts: string[] = []): Promise<DaemonDispatchResult> {
    return this.enqueue({
      trigger: "on_goal_finished",
      changedArtifacts: changedArtifacts.map(normalizeChangedPath)
    });
  }

  async flush(): Promise<void> {
    await this.pending;
  }

  async stop(): Promise<DaemonServiceStatus> {
    this.watcher?.close();
    this.watcher = undefined;

    if (this.timer) {
      this.clearIntervalFn(this.timer);
      this.timer = undefined;
    }

    await this.flush();
    this.stoppedAt = this.now().toISOString();

    return this.status();
  }

  status(): DaemonServiceStatus {
    return {
      running: Boolean(this.startedAt && !this.stoppedAt),
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      dispatches: this.dispatches.length,
      errors: [...this.errors]
    };
  }

  private enqueue(event: DaemonTriggerEvent): Promise<DaemonDispatchResult> {
    const dispatch = this.pending.then(() => this.dispatcher.dispatch(event));

    this.pending = dispatch.then(
      (result) => {
        this.dispatches.push(result);
      },
      (error: unknown) => {
        this.errors.push(error instanceof Error ? error.message : String(error));
      }
    );

    return dispatch;
  }
}
