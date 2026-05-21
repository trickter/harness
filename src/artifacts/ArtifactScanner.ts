import { extname } from "node:path";
import type { Artifact, ArtifactType } from "./Artifact.js";
import { ArtifactGraph } from "./ArtifactGraph.js";

function artifactId(uri: string): string {
  return uri.replaceAll("\\", "/").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function typeForPath(uri: string): ArtifactType {
  const normalized = uri.replaceAll("\\", "/").toLowerCase();
  const extension = extname(normalized);

  if (
    normalized.startsWith("test/") ||
    normalized.includes("/test/") ||
    normalized.includes(".test.") ||
    normalized.includes(".spec.")
  ) {
    return "test";
  }

  if ([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs"].includes(extension)) {
    return "source_code";
  }

  if ([".md", ".mdx", ".txt"].includes(extension)) {
    return "document";
  }

  if ([".csv", ".parquet", ".jsonl"].includes(extension)) {
    return "dataset";
  }

  if ([".yaml", ".yml", ".json", ".toml"].includes(extension)) {
    return "config";
  }

  return "report";
}

export class ArtifactScanner {
  fromPaths(paths: string[]): ArtifactGraph {
    const artifacts: Artifact[] = paths.map((uri) => ({
      id: artifactId(uri),
      type: typeForPath(uri),
      uri,
      metadata: {}
    }));

    return new ArtifactGraph({ artifacts });
  }
}
