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

  if (normalized.startsWith("issues/") || normalized.includes("/issues/")) {
    return "issue";
  }

  if (normalized.startsWith("prs/") || normalized.startsWith("pull-requests/") || normalized.includes("/prs/")) {
    return "pr";
  }

  if (extension === ".eml" || normalized.startsWith("email/") || normalized.startsWith("emails/")) {
    return "email";
  }

  if (normalized.startsWith("task/") || normalized.startsWith("tasks/") || normalized.includes("/tasks/")) {
    return "task";
  }

  if (isTestPath(normalized)) {
    return "test";
  }

  if (
    extension === ".sql" ||
    extension === ".prisma" ||
    normalized.includes("/schema/") ||
    normalized.includes("/schemas/") ||
    normalized.endsWith(".schema.json")
  ) {
    return "schema";
  }

  if (normalized.startsWith("experiments/") || normalized.includes("/experiments/")) {
    return "experiment";
  }

  if (
    normalized.startsWith("models/") ||
    normalized.includes("/models/") ||
    [".joblib", ".onnx", ".pkl", ".pt", ".safetensors"].includes(extension)
  ) {
    return "model";
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

  if (extension === ".ipynb") {
    return "notebook";
  }

  if ([".drawio", ".mmd", ".mermaid"].includes(extension)) {
    return "diagram";
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

function pythonImportSpecifiers(content: string): string[] {
  const moduleImports = [...content.matchAll(/(?:^|\n)\s*import\s+([A-Za-z0-9_.]+)/gmu)]
    .map((match) => match[1]?.trim())
    .filter((specifier): specifier is string => Boolean(specifier));
  const fromImports = [...content.matchAll(/(?:^|\n)\s*from\s+([.A-Za-z0-9_]+)\s+import\s+/gmu)]
    .map((match) => match[1]?.trim())
    .filter((specifier): specifier is string => Boolean(specifier));

  return [...moduleImports, ...fromImports];
}

function rustModuleSpecifiers(content: string): string[] {
  const modules = [...content.matchAll(/(?:^|\n)\s*(?:pub\s+)?mod\s+([A-Za-z0-9_]+)\s*;/gmu)]
    .map((match) => match[1]?.trim())
    .filter((specifier): specifier is string => Boolean(specifier));
  const uses = [...content.matchAll(/(?:^|\n)\s*use\s+crate::([A-Za-z0-9_:]+)/gmu)]
    .map((match) => match[1]?.trim().replaceAll("::", "/"))
    .filter((specifier): specifier is string => Boolean(specifier));

  return [...modules, ...uses];
}

function goImportSpecifiers(content: string): string[] {
  const inline = [...content.matchAll(/(?:^|\n)\s*import\s+(?:[A-Za-z0-9_]+\s+)?["']([^"']+)["']/gmu)]
    .map((match) => match[1]?.trim())
    .filter((specifier): specifier is string => Boolean(specifier));
  const blocks = [...content.matchAll(/(?:^|\n)\s*import\s*\(([\s\S]*?)\)/gmu)].flatMap((match) =>
    [...(match[1] ?? "").matchAll(/["']([^"']+)["']/gmu)]
      .map((specifier) => specifier[1]?.trim())
      .filter((specifier): specifier is string => Boolean(specifier))
  );

  return [...inline, ...blocks];
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

interface TsAliasRule {
  pattern: string;
  targets: string[];
  baseDir: string;
  baseUrl?: string;
}

interface WorkspacePackage {
  name: string;
  root: string;
  manifest: Artifact;
}

interface ResolutionContext {
  tsAliases: TsAliasRule[];
  workspacePackages: WorkspacePackage[];
  goModules: string[];
}

function parseJson(content: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(content) as unknown;

    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function stringRecord(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (typeof entry === "string") {
        return [[key, [entry]]];
      }

      if (Array.isArray(entry)) {
        const strings = entry.filter((candidate): candidate is string => typeof candidate === "string");

        return strings.length > 0 ? [[key, strings]] : [];
      }

      return [];
    })
  );
}

function aliasReplacement(pattern: string, specifier: string, target: string): string | undefined {
  if (!pattern.includes("*")) {
    return pattern === specifier ? target : undefined;
  }

  const [prefix, suffix = ""] = pattern.split("*");

  if (!specifier.startsWith(prefix ?? "") || !specifier.endsWith(suffix)) {
    return undefined;
  }

  const wildcard = specifier.slice(prefix?.length ?? 0, suffix ? -suffix.length : undefined);

  return target.replace("*", wildcard);
}

function tsAliasCandidates(specifier: string, aliases: TsAliasRule[]): string[] {
  return aliases.flatMap((alias) =>
    alias.targets.flatMap((target) => {
      const replaced = aliasReplacement(alias.pattern, specifier, target);

      if (!replaced) {
        return [];
      }

      const base = normalizeUri(posix.join(alias.baseDir, alias.baseUrl ?? "", replaced));
      const extension = posix.extname(base);

      return extension
        ? [base]
        : IMPORT_RESOLUTION_EXTENSIONS.flatMap((candidateExtension) => [
            `${base}${candidateExtension}`,
            `${base}/index${candidateExtension}`
          ]);
    })
  );
}

function workspacePackageCandidates(specifier: string, packages: WorkspacePackage[]): string[] {
  const workspace = packages.find(
    (candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`)
  );

  if (!workspace) {
    return [];
  }

  const suffix = specifier === workspace.name ? "" : specifier.slice(workspace.name.length + 1);
  const root = suffix ? posix.join(workspace.root, suffix) : workspace.root;

  return IMPORT_RESOLUTION_EXTENSIONS.flatMap((extension) => [
    `${root}${extension}`,
    `${root}/index${extension}`,
    `${root}/src/index${extension}`
  ]);
}

function candidateArtifacts(candidates: string[], byUri: Map<string, Artifact>): Artifact[] {
  return candidates.map((uri) => byUri.get(normalizeUri(uri))).filter((artifact): artifact is Artifact => Boolean(artifact));
}

function jsImportTargets(
  importer: Artifact,
  content: string,
  byUri: Map<string, Artifact>,
  context: ResolutionContext
): Artifact[] {
  const targets = importSpecifiers(content)
    .flatMap((specifier) => [
      ...importCandidates(importer, specifier),
      ...tsAliasCandidates(specifier, context.tsAliases),
      ...workspacePackageCandidates(specifier, context.workspacePackages)
    ])
    .map((uri) => byUri.get(uri))
    .filter((artifact): artifact is Artifact => Boolean(artifact));

  return [...new Map(targets.map((artifact) => [artifact.id, artifact])).values()];
}

function pythonCandidates(importer: Artifact, specifier: string): string[] {
  const importerDir = posix.dirname(normalizeUri(importer.uri));
  const relativeLevel = specifier.match(/^\.+/u)?.[0].length ?? 0;
  const module = specifier.slice(relativeLevel).replaceAll(".", "/");
  const relativeRoot =
    relativeLevel > 0
      ? Array.from({ length: Math.max(0, relativeLevel - 1) }).reduce<string>((dir) => posix.dirname(dir), importerDir)
      : "";
  const bases = new Set<string>();

  if (relativeLevel > 0) {
    bases.add(normalizeUri(posix.join(relativeRoot, module)));
  } else {
    bases.add(module);
    bases.add(posix.join("src", module));
  }

  return [...bases].flatMap((base) => [`${base}.py`, `${base}/__init__.py`]);
}

function rustCandidates(importer: Artifact, specifier: string): string[] {
  const importerDir = posix.dirname(normalizeUri(importer.uri));
  const crateRoot = normalizeUri(importer.uri).includes("/src/")
    ? normalizeUri(importer.uri).slice(0, normalizeUri(importer.uri).indexOf("/src/") + "/src".length)
    : importerDir;
  const bases = new Set([posix.join(importerDir, specifier), posix.join(crateRoot, specifier)]);

  return [...bases].flatMap((base) => [`${base}.rs`, `${base}/mod.rs`]);
}

function goImportTargets(
  content: string,
  artifacts: Artifact[],
  context: ResolutionContext
): Artifact[] {
  return goImportSpecifiers(content).flatMap((specifier) => {
    const module = context.goModules.find((candidate) => specifier === candidate || specifier.startsWith(`${candidate}/`));

    if (!module) {
      return [];
    }

    const localDirectory = specifier === module ? "" : specifier.slice(module.length + 1);

    return artifacts.filter(
      (artifact) =>
        artifact.type === "source_code" &&
        artifact.uri.endsWith(".go") &&
        normalizeUri(artifact.uri).startsWith(localDirectory ? `${localDirectory}/` : "")
    );
  });
}

function sourceDependencyTargets(
  artifact: Artifact,
  content: string,
  artifacts: Artifact[],
  byUri: Map<string, Artifact>,
  context: ResolutionContext
): Artifact[] {
  const extension = posix.extname(normalizeUri(artifact.uri));
  let targets: Artifact[] = [];

  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    targets = jsImportTargets(artifact, content, byUri, context);
  }

  if (extension === ".py") {
    targets = pythonImportSpecifiers(content).flatMap((specifier) =>
      candidateArtifacts(pythonCandidates(artifact, specifier), byUri)
    );
  }

  if (extension === ".rs") {
    targets = rustModuleSpecifiers(content).flatMap((specifier) =>
      candidateArtifacts(rustCandidates(artifact, specifier), byUri)
    );
  }

  if (extension === ".go") {
    targets = goImportTargets(content, artifacts, context);
  }

  return [...new Map(targets.map((target) => [target.id, target])).values()];
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

function tsAliasRules(artifact: Artifact, content: string): TsAliasRule[] {
  const manifest = parseJson(content);
  const compilerOptions = manifest?.compilerOptions;

  if (
    !["tsconfig.json", "jsconfig.json"].includes(posix.basename(normalizeUri(artifact.uri))) ||
    !compilerOptions ||
    typeof compilerOptions !== "object" ||
    Array.isArray(compilerOptions)
  ) {
    return [];
  }

  const options = compilerOptions as Record<string, unknown>;
  const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl : undefined;
  const baseDir = posix.dirname(normalizeUri(artifact.uri));

  return Object.entries(stringRecord(options.paths)).map(([pattern, targets]) => ({
    pattern,
    targets,
    baseDir: baseDir === "." ? "" : baseDir,
    baseUrl
  }));
}

function workspacePackages(artifacts: Artifact[], contents: Map<string, string>): WorkspacePackage[] {
  return artifacts.flatMap((artifact) => {
    if (posix.basename(normalizeUri(artifact.uri)) !== "package.json") {
      return [];
    }

    const manifest = parseJson(contents.get(artifact.id) ?? "");
    const name = manifest?.name;

    if (typeof name !== "string") {
      return [];
    }

    const root = posix.dirname(normalizeUri(artifact.uri));

    return [
      {
        name,
        root: root === "." ? "" : root,
        manifest: artifact
      }
    ];
  });
}

function goModules(artifacts: Artifact[], contents: Map<string, string>): string[] {
  return artifacts.flatMap((artifact) => {
    if (posix.basename(normalizeUri(artifact.uri)) !== "go.mod") {
      return [];
    }

    const module = contents.get(artifact.id)?.match(/(?:^|\n)\s*module\s+([^\s]+)/mu)?.[1]?.trim();

    return module ? [module] : [];
  });
}

function createResolutionContext(artifacts: Artifact[], contents: Map<string, string>): ResolutionContext {
  return {
    tsAliases: artifacts.flatMap((artifact) => tsAliasRules(artifact, contents.get(artifact.id) ?? "")),
    workspacePackages: workspacePackages(artifacts, contents),
    goModules: goModules(artifacts, contents)
  };
}

function workspacePatterns(manifest: Record<string, unknown>): string[] {
  if (Array.isArray(manifest.workspaces)) {
    return manifest.workspaces.filter((entry): entry is string => typeof entry === "string");
  }

  if (manifest.workspaces && typeof manifest.workspaces === "object" && !Array.isArray(manifest.workspaces)) {
    const packages = (manifest.workspaces as Record<string, unknown>).packages;

    return Array.isArray(packages) ? packages.filter((entry): entry is string => typeof entry === "string") : [];
  }

  return [];
}

function workspaceManifestEdges(
  artifacts: Artifact[],
  contents: Map<string, string>,
  context: ResolutionContext,
  edges: ArtifactEdge[],
  edgeKeys: Set<string>
): void {
  for (const artifact of artifacts) {
    if (posix.basename(normalizeUri(artifact.uri)) !== "package.json") {
      continue;
    }

    const manifest = parseJson(contents.get(artifact.id) ?? "");

    if (!manifest) {
      continue;
    }

    for (const pattern of workspacePatterns(manifest)) {
      const widened = normalizeUri(pattern).endsWith("/") ? `${normalizeUri(pattern)}**` : `${normalizeUri(pattern)}/**`;

      for (const workspace of context.workspacePackages) {
        if (workspace.manifest.id !== artifact.id && matchesPathPattern(workspace.manifest.uri, widened)) {
          addEdge(edges, edgeKeys, artifact, workspace.manifest, "configures");
        }
      }
    }

    const dependencies = Object.keys({
      ...(manifest.dependencies && typeof manifest.dependencies === "object" ? manifest.dependencies : {}),
      ...(manifest.devDependencies && typeof manifest.devDependencies === "object" ? manifest.devDependencies : {})
    });

    for (const dependency of dependencies) {
      const workspace = context.workspacePackages.find((candidate) => candidate.name === dependency);

      if (workspace && workspace.manifest.id !== artifact.id) {
        addEdge(edges, edgeKeys, artifact, workspace.manifest, "depends_on");
      }
    }
  }
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
  context: ResolutionContext,
  edges: ArtifactEdge[],
  edgeKeys: Set<string>
): void {
  const byUri = new Map(artifacts.map((artifact) => [normalizeUri(artifact.uri), artifact]));

  for (const artifact of artifacts) {
    const content = contents.get(artifact.id);

    if (!content) {
      continue;
    }

    const importedArtifacts = sourceDependencyTargets(artifact, content, artifacts, byUri, context);
    const referencedArtifacts = contentReferences(content, artifacts, artifact);

    if (artifact.type === "source_code" || artifact.type === "test") {
      const dependencies = [
        ...importedArtifacts,
        ...referencedArtifacts.filter((target) =>
          ["dataset", "experiment", "model", "schema"].includes(target.type)
        )
      ];

      for (const target of new Map(dependencies.map((target) => [target.id, target])).values()) {
        addEdge(edges, edgeKeys, artifact, target, "depends_on");

        if (artifact.type === "test" && target.type === "source_code") {
          addVerificationEdges(edges, edgeKeys, artifact, target);
        }
      }
    }

    if (artifact.type === "document") {
      for (const target of referencedArtifacts) {
        addEdge(edges, edgeKeys, artifact, target, "documents");
      }
    }

    if (artifact.type === "config") {
      const configured = [
        ...referencedArtifacts,
        ...importedArtifacts,
        ...configPatternTargets(content, artifacts)
      ];

      for (const target of new Map(configured.map((target) => [target.id, target])).values()) {
        if (target.id !== artifact.id) {
          addEdge(edges, edgeKeys, artifact, target, "configures");
        }
      }
    }

    if (artifact.type === "experiment") {
      for (const target of referencedArtifacts) {
        if (["dataset", "schema", "source_code"].includes(target.type)) {
          addEdge(edges, edgeKeys, artifact, target, "depends_on");
        }

        if (["model", "report"].includes(target.type)) {
          addEdge(edges, edgeKeys, artifact, target, "generates");
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

    const context = createResolutionContext(artifacts, contents);

    contentEdges(artifacts, contents, context, edges, edgeKeys);
    workspaceManifestEdges(artifacts, contents, context, edges, edgeKeys);

    return new ArtifactGraph({ artifacts, edges });
  }
}
