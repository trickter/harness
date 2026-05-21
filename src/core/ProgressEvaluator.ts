import { z } from "zod";
import type { RunLedgerEntry, VerificationResult } from "./RunLedger.js";
import { normalizeErrorSignature } from "./VerificationParser.js";

export const progressMetricsSchema = z.object({
  objectiveDelta: z.number(),
  errorSignatureChanged: z.boolean(),
  failureCount: z.number().int().nonnegative().default(0),
  failureCountDelta: z.number(),
  newInformationFound: z.boolean(),
  artifactQualityDelta: z.number(),
  scopeDriftScore: z.number().min(0),
  repeatedActionCount: z.number().int().nonnegative(),
  repeatedErrorCount: z.number().int().nonnegative(),
  noProgressCount: z.number().int().nonnegative(),
  changedArtifactsCount: z.number().int().nonnegative(),
  diffArtifactsCount: z.number().int().nonnegative().default(0),
  diffGrowthDelta: z.number().default(0),
  diffGrowthStreak: z.number().int().nonnegative().default(0),
  goalCompletionScore: z.number().min(0).max(1).default(0),
  confidenceDelta: z.number(),
  confidenceScore: z.number().min(0).max(1).default(0),
  worseningScore: z.number().min(0).default(0),
  gettingWorse: z.boolean().default(false)
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
  failureCount?: number;
  failureCountDelta?: number;
  artifactQualityDelta?: number;
  scopeDriftScore?: number;
  confidenceDelta?: number;
  successCriteriaMet?: boolean;
}

export interface ProgressEvaluation {
  metrics: ProgressMetrics;
  signal: ProgressSignal;
}

function clampScore(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function latestError(entries: RunLedgerEntry[]): string | undefined {
  const error = [...entries].reverse().find((entry) => entry.errorSignature)?.errorSignature;

  return error ? normalizeErrorSignature(error) : undefined;
}

function normalizedError(value: string | undefined): string | undefined {
  return value ? normalizeErrorSignature(value) : undefined;
}

function previousFailureCount(entries: RunLedgerEntry[]): number {
  const previousVerification = [...entries]
    .reverse()
    .find((entry) => entry.phase === "VERIFY" || entry.verificationResult === "pass" || entry.verificationResult === "fail");

  return previousVerification?.metrics.failureCount ?? 0;
}

function currentFailureCount(entries: RunLedgerEntry[], observation: ProgressObservation): number {
  const previous = previousFailureCount(entries);

  if (observation.failureCount !== undefined) {
    return Math.max(0, observation.failureCount);
  }

  if (observation.failureCountDelta !== undefined) {
    return Math.max(0, previous + observation.failureCountDelta);
  }

  if (observation.verificationResult === "pass") {
    return 0;
  }

  if (observation.verificationResult === "fail" || observation.verificationResult === "partial") {
    return previous || 1;
  }

  return previous;
}

function diffArtifacts(entries: RunLedgerEntry[], observation: ProgressObservation): Set<string> {
  return new Set([...entries.flatMap((entry) => entry.changedArtifacts), ...observation.changedArtifacts]);
}

function diffGrowthStreak(previous: RunLedgerEntry | undefined, diffGrowthDelta: number): number {
  if (diffGrowthDelta <= 0) {
    return 0;
  }

  return (previous?.metrics.diffGrowthStreak ?? 0) + 1;
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

function goalCompletionScore(
  previous: RunLedgerEntry | undefined,
  observation: ProgressObservation,
  objectiveDelta: number
): number {
  if (observation.successCriteriaMet && observation.verificationResult === "pass") {
    return 1;
  }

  return clampScore((previous?.metrics.goalCompletionScore ?? 0) + objectiveDelta);
}

function worseningScore(input: {
  observation: ProgressObservation;
  objectiveDelta: number;
  artifactQualityDelta: number;
  scopeDriftScore: number;
  failureCount: number;
  failureCountDelta: number;
  diffGrowthDelta: number;
  diffGrowthStreak: number;
  repeatedErrorCount: number;
}): number {
  const verificationPressure = input.observation.verificationResult === "pass" ? 0 : 0.25;
  const failurePressure =
    input.failureCountDelta > 0 ? Math.min(1.5, input.failureCountDelta * 0.5) : input.repeatedErrorCount > 0 ? 0.5 : 0;
  const diffPressure =
    input.diffGrowthStreak >= 2 ? 0.75 : input.diffGrowthDelta > 0 && input.failureCount > 0 ? 0.35 : 0;
  const regressionPressure = Math.max(0, -input.objectiveDelta) + Math.max(0, -input.artifactQualityDelta);

  return verificationPressure + failurePressure + diffPressure + input.scopeDriftScore + regressionPressure;
}

function isGettingWorse(input: {
  observation: ProgressObservation;
  worseningScore: number;
  failureCountDelta: number;
  diffGrowthStreak: number;
  scopeDriftScore: number;
  objectiveDelta: number;
  artifactQualityDelta: number;
}): boolean {
  if (input.observation.verificationResult === "pass") {
    return false;
  }

  const objectiveRegression = input.objectiveDelta < 0 || input.artifactQualityDelta < 0;
  const failureRegression = input.failureCountDelta > 0 && input.diffGrowthStreak > 0;
  const churnRegression = input.diffGrowthStreak >= 2 && input.objectiveDelta <= 0;

  return input.worseningScore >= 1 && (failureRegression || churnRegression || objectiveRegression || input.scopeDriftScore > 0);
}

function modeledConfidenceDelta(input: {
  observation: ProgressObservation;
  metrics: Pick<
    ProgressMetrics,
    | "artifactQualityDelta"
    | "errorSignatureChanged"
    | "failureCountDelta"
    | "gettingWorse"
    | "newInformationFound"
    | "repeatedErrorCount"
    | "scopeDriftScore"
  >;
}): number {
  const verificationSignal =
    input.observation.verificationResult === "pass"
      ? 0.25
      : input.observation.verificationResult === "fail"
        ? -0.2
        : input.observation.verificationResult === "partial"
          ? -0.1
          : 0;
  const informationSignal = input.metrics.newInformationFound ? 0.05 : 0;
  const discoverySignal = input.metrics.errorSignatureChanged && input.metrics.newInformationFound ? 0.03 : 0;
  const failureSignal = input.metrics.failureCountDelta > 0 ? -Math.min(0.2, input.metrics.failureCountDelta * 0.05) : 0;
  const repeatSignal = input.metrics.repeatedErrorCount > 0 ? -0.1 : 0;
  const scopeSignal = -Math.min(0.3, input.metrics.scopeDriftScore * 0.3);
  const artifactSignal = Math.max(-0.15, Math.min(0.15, input.metrics.artifactQualityDelta * 0.1));
  const worseningSignal = input.metrics.gettingWorse ? -0.15 : 0;

  return verificationSignal + informationSignal + discoverySignal + failureSignal + repeatSignal + scopeSignal + artifactSignal + worseningSignal;
}

export class ProgressEvaluator {
  evaluate(entries: RunLedgerEntry[], observation: ProgressObservation): ProgressEvaluation {
    const previous = entries.at(-1);
    const repeatedActionCount = entries.filter((entry) => entry.action === observation.action).length;
    const currentError = normalizedError(observation.errorSignature);
    const repeatedErrorCount = currentError
      ? entries.filter((entry) => normalizedError(entry.errorSignature) === currentError).length
      : 0;
    const objectiveDelta = observation.objectiveDelta ?? 0;
    const artifactQualityDelta = observation.artifactQualityDelta ?? 0;
    const failureCount = currentFailureCount(entries, observation);
    const failureCountDelta = observation.failureCountDelta ?? failureCount - previousFailureCount(entries);
    const scopeDriftScore = observation.scopeDriftScore ?? 0;
    const priorDiffArtifactsCount = new Set(entries.flatMap((entry) => entry.changedArtifacts)).size;
    const diffArtifactsCount = diffArtifacts(entries, observation).size;
    const diffGrowthDelta = diffArtifactsCount - priorDiffArtifactsCount;
    const currentDiffGrowthStreak = diffGrowthStreak(previous, diffGrowthDelta);
    const currentGoalCompletionScore = goalCompletionScore(previous, observation, objectiveDelta);
    const currentWorseningScore = worseningScore({
      observation,
      objectiveDelta,
      artifactQualityDelta,
      scopeDriftScore,
      failureCount,
      failureCountDelta,
      diffGrowthDelta,
      diffGrowthStreak: currentDiffGrowthStreak,
      repeatedErrorCount
    });
    const gettingWorse = isGettingWorse({
      observation,
      worseningScore: currentWorseningScore,
      failureCountDelta,
      diffGrowthStreak: currentDiffGrowthStreak,
      scopeDriftScore,
      objectiveDelta,
      artifactQualityDelta
    });

    const metricsWithoutConfidence = {
      objectiveDelta,
      errorSignatureChanged: latestError(entries) !== currentError,
      failureCount,
      failureCountDelta,
      newInformationFound: observation.newInformation.length > 0,
      artifactQualityDelta,
      scopeDriftScore,
      repeatedActionCount,
      repeatedErrorCount,
      noProgressCount: currentNoProgress(previous, observation),
      changedArtifactsCount: new Set(observation.changedArtifacts).size,
      diffArtifactsCount,
      diffGrowthDelta,
      diffGrowthStreak: currentDiffGrowthStreak,
      goalCompletionScore: currentGoalCompletionScore,
      worseningScore: currentWorseningScore,
      gettingWorse
    };
    const confidenceDelta =
      observation.confidenceDelta ??
      modeledConfidenceDelta({
        observation,
        metrics: metricsWithoutConfidence
      });
    const metrics: ProgressMetrics = {
      ...metricsWithoutConfidence,
      confidenceDelta,
      confidenceScore: clampScore((previous?.metrics.confidenceScore ?? 0) + confidenceDelta)
    };

    if (
      observation.verificationResult === "pass" &&
      (objectiveDelta > 0 || artifactQualityDelta > 0 || confidenceDelta > 0 || metrics.goalCompletionScore > 0)
    ) {
      return { metrics, signal: "positive" };
    }

    if (
      gettingWorse ||
      scopeDriftScore > 0 ||
      metrics.noProgressCount > 0 ||
      (repeatedErrorCount > 0 && observation.newInformation.length === 0)
    ) {
      return { metrics, signal: "negative" };
    }

    return { metrics, signal: "neutral" };
  }
}
