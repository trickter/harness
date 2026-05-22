import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { documentationConsistencyDaemon } from "../src/agents/DaemonAgent.js";
import { DocumentationDaemonRunner } from "../src/agents/DocumentationDaemonRunner.js";
import { ArtifactGraph } from "../src/artifacts/ArtifactGraph.js";
import { parseGoalContract } from "../src/core/GoalContract.js";
import { LoopController } from "../src/core/LoopController.js";
import { JsonlRunLedger } from "../src/core/RunLedger.js";

async function createDaemonRunner() {
  const directory = await mkdtemp(join(tmpdir(), "harness-doc-daemon-"));
  const ledger = new JsonlRunLedger(join(directory, "ledger.jsonl"));
  const contract = parseGoalContract({
    goal: {
      id: "doc-daemon",
      name: "Documentation Daemon",
      objective: "Check documentation consistency."
    },
    budget: {
      maxIterations: 4,
      maxSameError: 2,
      maxNoProgress: 3,
      maxEscapeRounds: 1,
      maxChangedArtifacts: 4,
      maxRuntimeMinutes: 5
    }
  });
  const loop = new LoopController(contract, ledger);

  return {
    ledger,
    runner: new DocumentationDaemonRunner(documentationConsistencyDaemon, loop)
  };
}

test("documentation daemon reports source changes without docs as partial", async () => {
  const { ledger, runner } = await createDaemonRunner();
  const result = await runner.run({ changedArtifacts: ["src/webhooks/signature.ts"] });
  const entries = await ledger.readAll();

  assert.equal(result.report.outputMode, "report_only");
  assert.equal(result.report.needsDocumentationReview, true);
  assert.deepEqual(result.report.staleDocumentationTargets, ["general"]);
  assert.deepEqual(result.report.changedSourceArtifacts, ["src/webhooks/signature.ts"]);
  assert.equal(result.turn.transition.to, "REPAIR");
  assert.equal(entries[0]?.verificationResult, "partial");
});

test("documentation daemon passes when docs changed with source", async () => {
  const { ledger, runner } = await createDaemonRunner();
  const result = await runner.run({
    changedArtifacts: ["src/webhooks/signature.ts", "docs/webhooks.md"]
  });
  const entries = await ledger.readAll();

  assert.equal(result.report.needsDocumentationReview, false);
  assert.deepEqual(result.report.changedDocumentationArtifacts, ["docs/webhooks.md"]);
  assert.equal(result.turn.transition.to, "FINISH");
  assert.equal(entries[0]?.verificationResult, "pass");
});

test("documentation daemon flags stale API and architecture documentation targets", async () => {
  const { runner } = await createDaemonRunner();
  const result = await runner.run({
    changedArtifacts: ["src/cli/index.ts", "src/core/StateMachine.ts", "docs/webhooks.md"]
  });

  assert.equal(result.report.needsDocumentationReview, true);
  assert.deepEqual(result.report.staleDocumentationTargets, ["readme-api", "architecture"]);
});

test("documentation daemon flags changed docs that do not document changed source", async () => {
  const { runner } = await createDaemonRunner();
  const result = await runner.run({
    changedArtifacts: ["src/webhooks/signature.ts", "docs/unrelated.md"],
    graph: new ArtifactGraph({
      artifacts: [
        { id: "source", type: "source_code", uri: "src/webhooks/signature.ts", metadata: {} },
        { id: "doc", type: "document", uri: "docs/unrelated.md", metadata: {} }
      ]
    })
  });

  assert.equal(result.report.needsDocumentationReview, true);
  assert.deepEqual(result.report.undocumentedSourceArtifacts, ["src/webhooks/signature.ts"]);
  assert.deepEqual(result.report.staleDocumentationTargets, ["source-references"]);
});
