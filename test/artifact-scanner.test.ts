import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ArtifactScanner } from "../src/artifacts/ArtifactScanner.js";
import type { ArtifactEdge, ArtifactGraph } from "../src/index.js";

function edge(graph: ArtifactGraph, fromUri: string, toUri: string, relation: ArtifactEdge["relation"]): boolean {
  const from = graph.listArtifacts().find((artifact) => artifact.uri === fromUri);
  const to = graph.listArtifacts().find((artifact) => artifact.uri === toUri);

  return Boolean(
    from &&
      to &&
      graph.listEdges().some((candidate) => candidate.from === from.id && candidate.to === to.id && candidate.relation === relation)
  );
}

test("artifact scanner infers path-stable test and conflict edges", () => {
  const graph = new ArtifactScanner().fromPaths([
    "src/auth/token.ts",
    "test/auth/token.test.ts",
    "src/auth/token.ts.orig"
  ]);

  assert.equal(edge(graph, "test/auth/token.test.ts", "src/auth/token.ts", "tests"), true);
  assert.equal(edge(graph, "test/auth/token.test.ts", "src/auth/token.ts", "validates"), true);
  assert.equal(edge(graph, "src/auth/token.ts.orig", "src/auth/token.ts", "conflicts_with"), true);
  assert.equal(edge(graph, "src/auth/token.ts", "src/auth/token.ts.orig", "conflicts_with"), true);
});

test("artifact scanner infers workspace content relationships", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-artifacts-"));
  const paths = [
    "src/webhooks/signature.ts",
    "src/webhooks/codec.ts",
    "test/webhooks/signature.test.ts",
    "docs/webhooks.md",
    "tsconfig.json",
    "src/webhooks/conflicted.ts"
  ];

  await mkdir(join(root, "src", "webhooks"), { recursive: true });
  await mkdir(join(root, "test", "webhooks"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(
    join(root, "src", "webhooks", "signature.ts"),
    'import { encode } from "./codec.js";\nexport const signature = encode("payload");\n',
    "utf8"
  );
  await writeFile(join(root, "src", "webhooks", "codec.ts"), "export const encode = String;\n", "utf8");
  await writeFile(
    join(root, "test", "webhooks", "signature.test.ts"),
    'import { signature } from "../../src/webhooks/signature.js";\nvoid signature;\n',
    "utf8"
  );
  await writeFile(
    join(root, "docs", "webhooks.md"),
    "Webhook signing is implemented by `src/webhooks/signature.ts`.\n",
    "utf8"
  );
  await writeFile(
    join(root, "tsconfig.json"),
    '{ "include": ["src/**/*.ts", "test/**/*.ts"] }\n',
    "utf8"
  );
  await writeFile(
    join(root, "src", "webhooks", "conflicted.ts"),
    "<<<<<<< current\nexport const conflicted = 1;\n=======\nexport const conflicted = 2;\n>>>>>>> incoming\n",
    "utf8"
  );

  const graph = await new ArtifactScanner().fromWorkspace(root, paths);
  const conflicted = graph.listArtifacts().find((artifact) => artifact.uri === "src/webhooks/conflicted.ts");

  assert.equal(edge(graph, "src/webhooks/signature.ts", "src/webhooks/codec.ts", "depends_on"), true);
  assert.equal(edge(graph, "test/webhooks/signature.test.ts", "src/webhooks/signature.ts", "depends_on"), true);
  assert.equal(edge(graph, "test/webhooks/signature.test.ts", "src/webhooks/signature.ts", "tests"), true);
  assert.equal(edge(graph, "test/webhooks/signature.test.ts", "src/webhooks/signature.ts", "validates"), true);
  assert.equal(edge(graph, "docs/webhooks.md", "src/webhooks/signature.ts", "documents"), true);
  assert.equal(edge(graph, "tsconfig.json", "src/webhooks/signature.ts", "configures"), true);
  assert.equal(edge(graph, "src/webhooks/conflicted.ts", "src/webhooks/conflicted.ts", "conflicts_with"), true);
  assert.equal(conflicted?.metadata.hasConflictMarkers, true);
});
