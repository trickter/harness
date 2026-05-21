export const ARTIFACT_TYPES = [
  "source_code",
  "test",
  "config",
  "document",
  "diagram",
  "dataset",
  "notebook",
  "model",
  "experiment",
  "issue",
  "pr",
  "email",
  "task",
  "report"
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export interface Artifact {
  id: string;
  type: ArtifactType;
  uri: string;
  metadata: Record<string, unknown>;
}

export const ARTIFACT_RELATIONS = [
  "implements",
  "references",
  "depends_on",
  "tests",
  "documents",
  "configures",
  "generates",
  "validates",
  "supersedes",
  "conflicts_with"
] as const;

export type ArtifactRelation = (typeof ARTIFACT_RELATIONS)[number];

export interface ArtifactEdge {
  from: string;
  to: string;
  relation: ArtifactRelation;
}
