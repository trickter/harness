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

test("artifact scanner resolves project dependencies and non-code lineage", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-project-artifacts-"));
  const paths = [
    "package.json",
    "packages/ui/package.json",
    "packages/ui/src/index.ts",
    "tsconfig.json",
    "src/app.ts",
    "src/core/token.ts",
    "src/db.ts",
    "db/schema.sql",
    "src/service.py",
    "py/lib/codec.py",
    "go.mod",
    "cmd/main.go",
    "internal/check/check.go",
    "crates/lib/src/lib.rs",
    "crates/lib/src/codec.rs",
    "data/train.csv",
    "experiments/run-1.json",
    "models/baseline.onnx",
    "issues/42.md",
    "prs/7.md",
    "emails/status.eml",
    "tasks/release.md"
  ];

  await Promise.all([
    mkdir(join(root, "packages", "ui", "src"), { recursive: true }),
    mkdir(join(root, "src", "core"), { recursive: true }),
    mkdir(join(root, "db"), { recursive: true }),
    mkdir(join(root, "py", "lib"), { recursive: true }),
    mkdir(join(root, "cmd"), { recursive: true }),
    mkdir(join(root, "internal", "check"), { recursive: true }),
    mkdir(join(root, "crates", "lib", "src"), { recursive: true }),
    mkdir(join(root, "data"), { recursive: true }),
    mkdir(join(root, "experiments"), { recursive: true }),
    mkdir(join(root, "models"), { recursive: true }),
    mkdir(join(root, "issues"), { recursive: true }),
    mkdir(join(root, "prs"), { recursive: true }),
    mkdir(join(root, "emails"), { recursive: true }),
    mkdir(join(root, "tasks"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(join(root, "package.json"), '{ "name": "root", "workspaces": ["packages/*"] }\n', "utf8"),
    writeFile(join(root, "packages", "ui", "package.json"), '{ "name": "@workspace/ui" }\n', "utf8"),
    writeFile(join(root, "packages", "ui", "src", "index.ts"), "export const ui = true;\n", "utf8"),
    writeFile(
      join(root, "tsconfig.json"),
      '{ "compilerOptions": { "baseUrl": ".", "paths": { "@core/*": ["src/core/*"] } } }\n',
      "utf8"
    ),
    writeFile(
      join(root, "src", "app.ts"),
      'import { token } from "@core/token";\nimport { ui } from "@workspace/ui";\nvoid token;\nvoid ui;\n',
      "utf8"
    ),
    writeFile(join(root, "src", "core", "token.ts"), "export const token = true;\n", "utf8"),
    writeFile(join(root, "src", "db.ts"), 'export const schemaPath = "db/schema.sql";\n', "utf8"),
    writeFile(join(root, "db", "schema.sql"), "create table audit_log (id integer);\n", "utf8"),
    writeFile(join(root, "src", "service.py"), "from py.lib.codec import encode\nencode('payload')\n", "utf8"),
    writeFile(join(root, "py", "lib", "codec.py"), "def encode(value):\n    return value\n", "utf8"),
    writeFile(join(root, "go.mod"), "module example.com/harness\n", "utf8"),
    writeFile(join(root, "cmd", "main.go"), 'package main\nimport "example.com/harness/internal/check"\nfunc main() { check.Run() }\n', "utf8"),
    writeFile(join(root, "internal", "check", "check.go"), "package check\nfunc Run() {}\n", "utf8"),
    writeFile(join(root, "crates", "lib", "src", "lib.rs"), "mod codec;\npub fn run() { codec::run(); }\n", "utf8"),
    writeFile(join(root, "crates", "lib", "src", "codec.rs"), "pub fn run() {}\n", "utf8"),
    writeFile(join(root, "data", "train.csv"), "label,value\n1,2\n", "utf8"),
    writeFile(
      join(root, "experiments", "run-1.json"),
      '{ "dataset": "data/train.csv", "model": "models/baseline.onnx" }\n',
      "utf8"
    ),
    writeFile(join(root, "models", "baseline.onnx"), "model", "utf8"),
    writeFile(join(root, "issues", "42.md"), "Investigate metrics.\n", "utf8"),
    writeFile(join(root, "prs", "7.md"), "Review model change.\n", "utf8"),
    writeFile(join(root, "emails", "status.eml"), "Subject: status\n", "utf8"),
    writeFile(join(root, "tasks", "release.md"), "Ship release.\n", "utf8")
  ]);

  const graph = await new ArtifactScanner().fromWorkspace(root, paths);
  const type = (uri: string) => graph.listArtifacts().find((artifact) => artifact.uri === uri)?.type;

  assert.equal(edge(graph, "src/app.ts", "src/core/token.ts", "depends_on"), true);
  assert.equal(edge(graph, "src/app.ts", "packages/ui/src/index.ts", "depends_on"), true);
  assert.equal(edge(graph, "package.json", "packages/ui/package.json", "configures"), true);
  assert.equal(edge(graph, "src/service.py", "py/lib/codec.py", "depends_on"), true);
  assert.equal(edge(graph, "cmd/main.go", "internal/check/check.go", "depends_on"), true);
  assert.equal(edge(graph, "crates/lib/src/lib.rs", "crates/lib/src/codec.rs", "depends_on"), true);
  assert.equal(edge(graph, "src/db.ts", "db/schema.sql", "depends_on"), true);
  assert.equal(edge(graph, "experiments/run-1.json", "data/train.csv", "depends_on"), true);
  assert.equal(edge(graph, "experiments/run-1.json", "models/baseline.onnx", "generates"), true);
  assert.equal(type("db/schema.sql"), "schema");
  assert.equal(type("experiments/run-1.json"), "experiment");
  assert.equal(type("models/baseline.onnx"), "model");
  assert.equal(type("issues/42.md"), "issue");
  assert.equal(type("prs/7.md"), "pr");
  assert.equal(type("emails/status.eml"), "email");
  assert.equal(type("tasks/release.md"), "task");
});
