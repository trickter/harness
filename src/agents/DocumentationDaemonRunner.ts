import type { LoopController, LoopTurnResult } from "../core/LoopController.js";
import type { DaemonSpec } from "./DaemonAgent.js";

export interface DocumentationDaemonReport {
  daemon: string;
  outputMode: "report_only";
  changedSourceArtifacts: string[];
  changedDocumentationArtifacts: string[];
  findings: string[];
  staleDocumentationTargets: string[];
  needsDocumentationReview: boolean;
}

export interface DocumentationDaemonRunResult {
  report: DocumentationDaemonReport;
  turn: LoopTurnResult;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function isDocumentationArtifact(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase();

  return (
    normalized === "readme" ||
    normalized.startsWith("readme.") ||
    normalized.startsWith("docs/") ||
    normalized.endsWith(".md") ||
    normalized.endsWith(".mdx")
  );
}

function isSourceArtifact(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase();

  if (isDocumentationArtifact(normalized)) {
    return false;
  }

  return (
    normalized.startsWith("src/") ||
    normalized.startsWith("lib/") ||
    normalized.startsWith("app/") ||
    [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs"].some((extension) => normalized.endsWith(extension))
  );
}

function hasDocumentation(paths: string[], pattern: RegExp): boolean {
  return paths.some((path) => pattern.test(normalizePath(path).toLowerCase()));
}

function staleDocumentationTargets(source: string[], docs: string[]): string[] {
  const targets = new Set<string>();
  const hasAnyDocs = docs.length > 0;

  if (!hasAnyDocs) {
    targets.add("general");
  }

  if (
    source.some((path) => /(?:^|\/)(?:cli|api)(?:\/|\.|-)/u.test(normalizePath(path).toLowerCase())) &&
    !hasDocumentation(docs, /(?:^readme(?:\.|$)|^docs\/api(?:\/|\.|-))/u)
  ) {
    targets.add("readme-api");
  }

  if (
    source.some((path) => /^(?:src|lib)\/(?:core|agents|adapters)(?:\/|$)/u.test(normalizePath(path).toLowerCase())) &&
    !hasDocumentation(docs, /(?:^docs\/(?:architecture|design)(?:\/|\.|-)|architecture|\.drawio$|\.mmd$|\.mermaid$)/u)
  ) {
    targets.add("architecture");
  }

  return [...targets];
}

export class DocumentationDaemonRunner {
  readonly spec: DaemonSpec;
  readonly loop: LoopController;

  constructor(spec: DaemonSpec, loop: LoopController) {
    this.spec = spec;
    this.loop = loop;
  }

  async run(input: { changedArtifacts: string[] }): Promise<DocumentationDaemonRunResult> {
    if (this.spec.outputMode !== "report_only") {
      throw new Error("documentation daemon runner only supports report_only output mode");
    }

    const changedSourceArtifacts = input.changedArtifacts.filter(isSourceArtifact);
    const changedDocumentationArtifacts = input.changedArtifacts.filter(isDocumentationArtifact);
    const staleTargets = staleDocumentationTargets(changedSourceArtifacts, changedDocumentationArtifacts);
    const needsDocumentationReview = changedSourceArtifacts.length > 0 && staleTargets.length > 0;
    const findings = needsDocumentationReview
      ? [
          `${changedSourceArtifacts.length} source artifact(s) changed with stale documentation targets: ${staleTargets.join(", ")}.`,
          "Review README, API references, architecture notes, and diagrams required by the changed source surface."
        ]
      : ["No documentation consistency gap detected from the provided changed artifacts."];
    const report: DocumentationDaemonReport = {
      daemon: this.spec.name,
      outputMode: "report_only",
      changedSourceArtifacts,
      changedDocumentationArtifacts,
      findings,
      staleDocumentationTargets: staleTargets,
      needsDocumentationReview
    };
    const turn = await this.loop.recordTurn({
      phase: "VERIFY",
      action: `Run ${this.spec.name} in report_only mode.`,
      changedArtifacts: [],
      commandsRun: [],
      verificationResult: needsDocumentationReview ? "partial" : "pass",
      errorSignature: needsDocumentationReview ? `${this.spec.name}:documentation-review-needed` : undefined,
      newInformation: findings,
      objectiveDelta: needsDocumentationReview ? 0 : 1,
      artifactQualityDelta: needsDocumentationReview ? 0 : 1,
      confidenceDelta: needsDocumentationReview ? 0 : 1,
      successCriteriaMet: !needsDocumentationReview
    });

    return { report, turn };
  }
}
