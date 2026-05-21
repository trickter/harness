import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type { Artifact, ArtifactEdge, ArtifactRelation, ArtifactType } from "./Artifact.js";
import { ArtifactGraph } from "./ArtifactGraph.js";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs"];
const IMPORT_RESOLUTION_EXTENSIONS = [...SOURCE_EXTENSIONS, ".json", ".yaml", ".yml", ".toml"];
const CONFLICT_COPY_SUFFIXES = [".orig", ".rej", ".bak", "~"];

function normalizeUri(uri: string): string {
  return uri.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function artifactId(uri: string): string {
  return normalizeUri(uri).replace(/[^a-zA-Z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
}

function isTestPath(uri: string): boolean {
  return (
    uri.startsWith("test/") ||
    uri.startsWith("tests/") ||
    uri.includes("/test/") ||
    uri.includes("/tests/") ||
    uri.includes("/__tests__/") ||
    uri.includes(".test.") ||
    uri.includes(".spec.")
  );
}

function isConfigPath(uri: string, extension: string): boolean {
  const basename = posix.basename(uri);

  return (
    [".yaml", ".yml", ".json", ".toml"].includes(extension) ||
    basename === "package-lock.json" ||
    basename === "package.json" ||
    basename === "tsconfig.json" ||
    basename === "jsconfig.json" ||
    basename.startsWith(".eslintrc") ||
    basename.startsWith(".prettierrc") ||
    basename.includes(".config.")
  );
}

function typeForPath(uri: string): ArtifactType {
  const normalized = normalizeUri(uri).toLowerCase();
  const extension = posix.extname(normalized);

  if (isTestPath(normalized)) {
    return "test";
  }

  if (isConfigPath(normalized, extension)) {
    return "config";
  }

  if (SOURCE_EXTENSIONS.includes(extension)) {
    return "source_code";
  }

  if ([".md", ".mdx", ".txt"].includes(extension)) {
    return "document";
  }

  if ([".csv", ".parquet", ".jsonl"].includes(extension)) {
    return "dataset";
  }

  return "report";
}

function withoutKnownExtension(uri: string): string {
  const extension = posix.extname(uri);

  return extension ? uri.slice(0, -extension.length) : uri;
}

function sourceKey(uri: string): string {
  const segments = withoutKnownExtension(normalizeUri(uri))
    .replace(/\.(?:test|spec)$/u, "")
    .split("/")
    .filter((segment) => !["src", "lib", "app", "test", "tests", "__tests__"].includes(segment));

  return segments.join("/");
}

function conflictOriginalUri(uri: string): string | undefined {
  return CONFLICT_COPY_SUFFIXES.find((suffix) => uri.endsWith(suffix))
    ? CONFLICT_COPY_SUFFIXES.reduce<string | undefined>(
        (original, suffix) => original ?? (uri.endsWith(suffix) ? uri.slice(0, -suffix.length) : undefined),
        undefined
      )
    : undefined;
}

function hasConflictMarkers(content: string): boolean {
  return /^<{7}(?: .*)?$/mu.test(content) && /^={7}$/mu.test(content) && /^>{7}(?: .*)?$/mu.test(content);
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
}

function matchesPathPattern(uri: string, pattern: string): boolean {
  const normalizedPattern = normalizeUri(pattern).replace(/^\//u, "");
  const regex = escapeRegex(normalizedPattern)
    .replaceAll("**/", "\0")
    .replaceAll("**", "\u0001")
    .replaceAll("*", "[^/]*")
    .replaceAll("\0", "(?:.*/)?")
    .replaceAll("\u0001", ".*");

  return new RegExp(`^${regex}$`, "u").test(normalizeUri(uri));
}

function contentReferences(content: string, artifacts: Artifact[], source: Artifact): Artifact[] {
  const normalizedContent = content.replaceAll("\\", "/");

  return artifacts.filter((artifact) => artifact.id !== source.id && normalizedContent.includes(normalizeUri(artifact.uri)));
}

function importSpecifiers(content: string): string[] {
  const patterns = [
    /(?:^|\n)\s*import\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/gmu,
    /(?:^|\n)\s*export\s+[^"'`]*?\s+from\s+["']([^"']+)["']/gmu,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/gmu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gmu
  ];

  return patterns.flatMap((pattern) =>
    [...content.matchAll(pattern)]
      .map((match) => match[1]?.trim())
      .filter((specifier): specifier is string => Boolean(specifier))
  );
}

function importCandidates(importer: Artifact, specifier: string): string[] {
  if (!specifier.startsWith(".")) {
    return [];
  }

  const resolved = normalizeUri(posix.normalize(posix.join(posix.dirname(normalizeUri(importer.uri)), specifier)));
  const extension = posix.extname(resolved);
  const bases = new Set([resolved]);

  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    bases.add(resolved.slice(0, -extension.length));
  }

  if (extension) {
    return [...bases].flatMap((base) =>
      base === resolved ? [base] : IMPORT_RESOLUTION_EXTENSIONS.map((candidateExtension) => `${base}${candidateExtension}`)
    );
  }

  return IMPORT_RESOLUTION_EXTENSIONS.flatMap((candidateExtension) => [
    `${resolved}${candidateExtension}`,
    `${resolved}/index${candidateExtension}`
  ]);
}

function importTargets(importer: Artifact, content: string, byUri: Map<string, Artifact>): Artifact[] {
  const targets = importSpecifiers(content)
    .flatMap((specifier) => importCandidates(importer, specifier))
    .map((uri) => byUri.get(uri))
    .filter((artifact): artifact is Artifact => Boolean(artifact));

  return [...new Map(targets.map((artifact) => [artifact.id, artifact])).values()];
}

function jsonStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(jsonStrings);
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap(jsonStrings);
  }

  return [];
}

function configPatternTargets(content: string, artifacts: Artifact[]): Artifact[] {
  let patterns: string[];

  try {
    patterns = jsonStrings(JSON.parse(content));
  } catch {
    return [];
  }

  const targets = patterns.flatMap((pattern) => {
    const normalized = normalizeUri(pattern);

    if (!normalized.includes("/") && !normalized.includes("*")) {
      return [];
    }

    const widened = normalized.endsWith("/") ? `${normalized}**` : normalized;

    return artifacts.filter((artifact) => matchesPathPattern(artifact.uri, widened));
  });

  return [...new Map(targets.map((artifact) => [artifact.id, artifact])).values()];
}

function addEdge(edges: ArtifactEdge[], edgeKeys: Set<string>, from: Artifact, to: Artifact, relation: ArtifactRelation): void {
  const key = `${from.id}\0${relation}\0${to.id}`;

  if (!edgeKeys.has(key)) {
    edgeKeys.add(key);
    edges.push({ from: from.id, to: to.id, relation });
  }
}

function addVerificationEdges(
  edges: ArtifactEdge[],
  edgeKeys: Set<string>,
  testArtifact: Artifact,
  target: Artifact
): void {
  addEdge(edges, edgeKeys, testArtifact, target, "tests");
  addEdge(edges, edgeKeys, testArtifact, target, "validates");
}

function pathEdges(artifacts: Artifact[], edges: ArtifactEdge[], edgeKeys: Set<string>): void {
  const sourceByKey = new Map(
    artifacts.filter((artifact) => artifact.type === "source_code").map((artifact) => [sourceKey(artifact.uri), artifact])
  );
  const byUri = new Map(artifacts.map((artifact) => [normalizeUri(artifact.uri), artifact]));

  for (const artifact of artifacts) {
    if (artifact.type === "test") {
      const tested = sourceByKey.get(sourceKey(artifact.uri));

      if (tested) {
        addVerificationEdges(edges, edgeKeys, artifact, tested);
      }
    }

    const original = conflictOriginalUri(normalizeUri(artifact.uri));
    const originalArtifact = original ? byUri.get(original) : undefined;

    if (originalArtifact) {
      addEdge(edges, edgeKeys, artifact, originalArtifact, "conflicts_with");
      addEdge(edges, edgeKeys, originalArtifact, artifact, "conflicts_with");
    }
  }
}

function contentEdges(
  artifacts: Artifact[],
  contents: Map<string, string>,
  edges: ArtifactEdge[],
  edgeKeys: Set<string>
): void {
  const byUri = new Map(artifacts.map((artifact) => [normalizeUri(artifact.uri), artifact]));

  for (const artifact of artifacts) {
    const content = contents.get(artifact.id);

    if (!content) {
      continue;
    }

    const importedArtifacts = importTargets(artifact, content, byUri);

    if (artifact.type === "source_code" || artifact.type === "test") {
      for (const target of importedArtifacts) {
        addEdge(edges, edgeKeys, artifact, target, "depends_on");

        if (artifact.type === "test" && target.type === "source_code") {
          addVerificationEdges(edges, edgeKeys, artifact, target);
        }
      }
    }

    if (artifact.type === "document") {
      for (const target of contentReferences(content, artifacts, artifact)) {
        addEdge(edges, edgeKeys, artifact, target, "documents");
      }
    }

    if (artifact.type === "config") {
      const configured = [
        ...contentReferences(content, artifacts, artifact),
        ...importedArtifacts,
        ...configPatternTargets(content, artifacts)
      ];

      for (const target of new Map(configured.map((target) => [target.id, target])).values()) {
        if (target.id !== artifact.id) {
          addEdge(edges, edgeKeys, artifact, target, "configures");
        }
      }
    }

    if (hasConflictMarkers(content)) {
      artifact.metadata.hasConflictMarkers = true;
      addEdge(edges, edgeKeys, artifact, artifact, "conflicts_with");
    }
  }
}

async function readArtifactContent(root: string, artifact: Artifact): Promise<string | undefined> {
  try {
    return await readFile(join(root, normalizeUri(artifact.uri)), "utf8");
  } catch (error) {
    if (["ENOENT", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      return undefined;
    }

    throw error;
  }
}

function artifactsFromPaths(paths: string[]): Artifact[] {
  const byUri = new Map<string, Artifact>();

  for (const uri of paths.map(normalizeUri)) {
    byUri.set(uri, {
      id: artifactId(uri),
      type: typeForPath(uri),
      uri,
      metadata: {}
    });
  }

  return [...byUri.values()];
}

export class ArtifactScanner {
  fromPaths(paths: string[]): ArtifactGraph {
    const artifacts = artifactsFromPaths(paths);
    const edges: ArtifactEdge[] = [];
    const edgeKeys = new Set<string>();

    pathEdges(artifacts, edges, edgeKeys);

    return new ArtifactGraph({ artifacts, edges });
  }

  async fromWorkspace(root: string, paths: string[]): Promise<ArtifactGraph> {
    const artifacts = artifactsFromPaths(paths);
    const edges: ArtifactEdge[] = [];
    const edgeKeys = new Set<string>();
    const contents = new Map<string, string>();

    pathEdges(artifacts, edges, edgeKeys);

    for (const artifact of artifacts) {
      const content = await readArtifactContent(root, artifact);

      if (content !== undefined) {
        contents.set(artifact.id, content);
      }
    }

    contentEdges(artifacts, contents, edges, edgeKeys);

    return new ArtifactGraph({ artifacts, edges });
  }
}
