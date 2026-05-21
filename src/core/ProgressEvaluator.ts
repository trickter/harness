import { z } from "zod";
import type { RunLedgerEntry, VerificationResult } from "./RunLedger.js";

export const progressMetricsSchema = z.object({
  objectiveDelta: z.number(),
  errorSignatureChanged: z.boolean(),
  failureCountDelta: z.number(),
  newInformationFound: z.boolean(),
  artifactQualityDelta: z.number(),
  scopeDriftScore: z.number().min(0),
  repeatedActionCount: z.number().int().nonnegative(),
  repeatedErrorCount: z.number().int().nonnegative(),
  noProgressCount: z.number().int().nonnegative(),
  changedArtifactsCount: z.number().int().nonnegative(),
  confidenceDelta: z.number()
});

export type ProgressMetrics = z.infer<typeof progressMetricsSchema>;
export type ProgressSignal = "positive" | "neutral" | "negative";

export interface ProgressObservation {
  action: string;
  changedArtifacts: string[];
  verificationResult: VerificationResult;
  errorSignature?: string;
  newInformation: string[];
  objectiveDelta?: number;
  failureCountDelta?: number;
  artifactQualityDelta?: number;
  scopeDriftScore?: number;
  confidenceDelta?: number;
}

export interface ProgressEvaluation {
  metrics: ProgressMetrics;
  signal: ProgressSignal;
}

function latestError(entries: RunLedgerEntry[]): string | undefined {
  return [...entries].reverse().find((entry) => entry.errorSignature)?.errorSignature;
}

function currentNoProgress(
  previous: RunLedgerEntry | undefined,
  observation: ProgressObservation
): number {
  const noProgress =
    (observation.objectiveDelta ?? 0) <= 0 &&
    observation.newInformation.length === 0 &&
    observation.verificationResult !== "pass";

  if (!noProgress) {
    return 0;
  }

  return (previous?.metrics.noProgressCount ?? 0) + 1;
}

export class ProgressEvaluator {
  evaluate(entries: RunLedgerEntry[], observation: ProgressObservation): ProgressEvaluation {
    const previous = entries.at(-1);
    const repeatedActionCount = entries.filter((entry) => entry.action === observation.action).length;
    const repeatedErrorCount = observation.errorSignature
      ? entries.filter((entry) => entry.errorSignature === observation.errorSignature).length
      : 0;
    const objectiveDelta = observation.objectiveDelta ?? 0;
    const artifactQualityDelta = observation.artifactQualityDelta ?? 0;
    const failureCountDelta = observation.failureCountDelta ?? 0;
    const scopeDriftScore = observation.scopeDriftScore ?? 0;
    const confidenceDelta = observation.confidenceDelta ?? 0;

    const metrics: ProgressMetrics = {
      objectiveDelta,
      errorSignatureChanged: latestError(entries) !== observation.errorSignature,
      failureCountDelta,
      newInformationFound: observation.newInformation.length > 0,
      artifactQualityDelta,
      scopeDriftScore,
      repeatedActionCount,
      repeatedErrorCount,
      noProgressCount: currentNoProgress(previous, observation),
      changedArtifactsCount: new Set(observation.changedArtifacts).size,
      confidenceDelta
    };

    if (
      observation.verificationResult === "pass" &&
      (objectiveDelta > 0 || artifactQualityDelta > 0 || confidenceDelta > 0)
    ) {
      return { metrics, signal: "positive" };
    }

    if (
      scopeDriftScore > 0 ||
      metrics.noProgressCount > 0 ||
      (repeatedErrorCount > 0 && observation.newInformation.length === 0)
    ) {
      return { metrics, signal: "negative" };
    }

    return { metrics, signal: "neutral" };
  }
}
