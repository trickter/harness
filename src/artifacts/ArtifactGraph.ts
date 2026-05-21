import type { Artifact, ArtifactEdge } from "./Artifact.js";

export class ArtifactGraph {
  private readonly artifacts = new Map<string, Artifact>();
  private readonly edges: ArtifactEdge[] = [];

  constructor(input: { artifacts?: Artifact[]; edges?: ArtifactEdge[] } = {}) {
    for (const artifact of input.artifacts ?? []) {
      this.addArtifact(artifact);
    }

    for (const edge of input.edges ?? []) {
      this.addEdge(edge);
    }
  }

  addArtifact(artifact: Artifact): void {
    this.artifacts.set(artifact.id, artifact);
  }

  addEdge(edge: ArtifactEdge): void {
    if (!this.artifacts.has(edge.from) || !this.artifacts.has(edge.to)) {
      throw new Error(`artifact edge ${edge.from} -> ${edge.to} references an unknown artifact`);
    }

    this.edges.push(edge);
  }

  getArtifact(id: string): Artifact | undefined {
    return this.artifacts.get(id);
  }

  listArtifacts(): Artifact[] {
    return [...this.artifacts.values()];
  }

  listEdges(): ArtifactEdge[] {
    return [...this.edges];
  }

  relatedTo(id: string): ArtifactEdge[] {
    return this.edges.filter((edge) => edge.from === id || edge.to === id);
  }

  toJSON(): { artifacts: Artifact[]; edges: ArtifactEdge[] } {
    return {
      artifacts: this.listArtifacts(),
      edges: this.listEdges()
    };
  }
}
