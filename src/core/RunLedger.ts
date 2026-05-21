import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { progressMetricsSchema, type ProgressMetrics, type ProgressSignal } from "./ProgressEvaluator.js";
import { PHASES, type Phase } from "./StateMachine.js";

export const VERIFICATION_RESULTS = ["pass", "fail", "partial", "skipped"] as const;
export type VerificationResult = (typeof VERIFICATION_RESULTS)[number];

export const runLedgerEntrySchema = z.object({
  iteration: z.number().int().positive(),
  phase: z.enum(PHASES),
  goalId: z.string().trim().min(1),
  currentHypothesis: z.string().trim().optional(),
  action: z.string().trim().min(1),
  changedArtifacts: z.array(z.string()),
  commandsRun: z.array(z.string()),
  verificationResult: z.enum(VERIFICATION_RESULTS),
  errorSignature: z.string().trim().optional(),
  progressSignal: z.enum(["positive", "neutral", "negative"]),
  newInformation: z.array(z.string()),
  metrics: progressMetricsSchema,
  nextPhase: z.enum(PHASES),
  timestamp: z.string().datetime()
});

export interface RunLedgerEntry {
  iteration: number;
  phase: Phase;
  goalId: string;
  currentHypothesis?: string;
  action: string;
  changedArtifacts: string[];
  commandsRun: string[];
  verificationResult: VerificationResult;
  errorSignature?: string;
  progressSignal: ProgressSignal;
  newInformation: string[];
  metrics: ProgressMetrics;
  nextPhase: Phase;
  timestamp: string;
}

export interface RunLedgerStore {
  append(entry: RunLedgerEntry): Promise<void>;
  readAll(): Promise<RunLedgerEntry[]>;
  window(size: number): Promise<RunLedgerEntry[]>;
}

export class JsonlRunLedger implements RunLedgerStore {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async append(entry: RunLedgerEntry): Promise<void> {
    const parsed = runLedgerEntrySchema.parse(entry);
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(parsed)}\n`, "utf8");
  }

  async readAll(): Promise<RunLedgerEntry[]> {
    let raw: string;

    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }

    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => runLedgerEntrySchema.parse(JSON.parse(line)));
  }

  async window(size: number): Promise<RunLedgerEntry[]> {
    if (!Number.isInteger(size) || size <= 0) {
      throw new Error("ledger window size must be a positive integer");
    }

    return (await this.readAll()).slice(-size);
  }
}
