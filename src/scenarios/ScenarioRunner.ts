import {
  architectureDaemonRegistration,
  documentationDaemonRegistration,
  testCoverageDaemonRegistration,
  type DaemonRegistration
} from "../agents/DaemonScheduler.js";
import type { Artifact, ArtifactEdge } from "../artifacts/Artifact.js";
import { ArtifactGraph } from "../artifacts/ArtifactGraph.js";
import { ArtifactScanner } from "../artifacts/ArtifactScanner.js";
import type { GoalContract } from "../core/GoalContract.js";
import { createAutoModelingScenario } from "./AutoModelingScenario.js";
import { createDailyWorkScenario } from "./DailyWorkScenario.js";
import { createRefactorScenario } from "./RefactorScenario.js";

export const BUILTIN_SCENARIO_NAMES = ["refactor", "auto-modeling", "daily-work"] as const;
export type BuiltinScenarioName = (typeof BUILTIN_SCENARIO_NAMES)[number];

export interface ScenarioCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ScenarioVerificationReport {
  scenario: BuiltinScenarioName;
  passed: boolean;
  checks: ScenarioCheck[];
}

export interface ScenarioRunResult {
  scenario: BuiltinScenarioName;
  contract: GoalContract;
  artifacts: ArtifactGraph;
  verification: ScenarioVerificationReport;
  daemons: string[];
}

interface ScenarioDefinition {
  name: BuiltinScenarioName;
  contract(): GoalContract;
  daemons(): DaemonRegistration[];
  checks(graph: ArtifactGraph): ScenarioCheck[];
}

function artifactsOf(graph: ArtifactGraph, type: Artifact["type"]): Artifact[] {
  return graph.listArtifacts().filter((artifact) => artifact.type === type);
}

function edgeCount(graph: ArtifactGraph, relation: ArtifactEdge["relation"]): number {
  return graph.listEdges().filter((edge) => edge.relation === relation).length;
}

function hasExperimentLineage(graph: ArtifactGraph): boolean {
  const experiments = new Set(artifactsOf(graph, "experiment").map((artifact) => artifact.id));
  const datasetInputs = graph
    .listEdges()
    .filter((edge) => experiments.has(edge.from) && edge.relation === "depends_on")
    .map((edge) => graph.getArtifact(edge.to))
    .filter((artifact): artifact is Artifact => artifact?.type === "dataset");
  const modelOutputs = graph
    .listEdges()
    .filter((edge) => experiments.has(edge.from) && edge.relation === "generates")
    .map((edge) => graph.getArtifact(edge.to))
    .filter((artifact): artifact is Artifact => artifact?.type === "model");

  return datasetInputs.length > 0 && modelOutputs.length > 0;
}

function check(name: string, passed: boolean, detail: string): ScenarioCheck {
  return { name, passed, detail };
}

const DEFINITIONS: Record<BuiltinScenarioName, ScenarioDefinition> = {
  refactor: {
    name: "refactor",
    contract: createRefactorScenario,
    daemons: () => [architectureDaemonRegistration(), testCoverageDaemonRegistration()],
    checks(graph) {
      return [
        check("source_artifacts", artifactsOf(graph, "source_code").length > 0, "Refactor runs need source artifacts."),
        check("test_artifacts", artifactsOf(graph, "test").length > 0, "Refactor runs need test artifacts."),
        check("validation_edges", edgeCount(graph, "validates") > 0, "Refactor tests must validate source behavior.")
      ];
    }
  },
  "auto-modeling": {
    name: "auto-modeling",
    contract: createAutoModelingScenario,
    daemons: () => [testCoverageDaemonRegistration()],
    checks(graph) {
      return [
        check("dataset_artifacts", artifactsOf(graph, "dataset").length > 0, "Modeling needs a dataset artifact."),
        check("experiment_artifacts", artifactsOf(graph, "experiment").length > 0, "Modeling needs an experiment artifact."),
        check("model_artifacts", artifactsOf(graph, "model").length > 0, "Modeling needs a model artifact."),
        check("experiment_lineage", hasExperimentLineage(graph), "Experiments must depend on data and generate models.")
      ];
    }
  },
  "daily-work": {
    name: "daily-work",
    contract: createDailyWorkScenario,
    daemons: () => [documentationDaemonRegistration(), testCoverageDaemonRegistration()],
    checks(graph) {
      const documentCount = artifactsOf(graph, "document").length;
      const reportCount = artifactsOf(graph, "report").length;

      return [
        check("task_artifacts", artifactsOf(graph, "task").length > 0, "Daily work needs a task artifact."),
        check(
          "summary_artifacts",
          documentCount + reportCount > 0,
          "Daily work needs a document or report artifact for the summary."
        )
      ];
    }
  }
};

export class ScenarioVerifier {
  verify(scenario: BuiltinScenarioName, graph: ArtifactGraph): ScenarioVerificationReport {
    const checks = DEFINITIONS[scenario].checks(graph);

    return {
      scenario,
      passed: checks.every((candidate) => candidate.passed),
      checks
    };
  }
}

export class BuiltinScenarioRunner {
  readonly scenario: BuiltinScenarioName;
  readonly scanner: ArtifactScanner;
  readonly verifier: ScenarioVerifier;

  constructor(scenario: BuiltinScenarioName, scanner = new ArtifactScanner(), verifier = new ScenarioVerifier()) {
    this.scenario = scenario;
    this.scanner = scanner;
    this.verifier = verifier;
  }

  contract(): GoalContract {
    return DEFINITIONS[this.scenario].contract();
  }

  daemonRegistrations(): DaemonRegistration[] {
    return DEFINITIONS[this.scenario].daemons();
  }

  async run(input: { cwd: string; paths: string[] }): Promise<ScenarioRunResult> {
    const artifacts = await this.scanner.fromWorkspace(input.cwd, input.paths);

    return {
      scenario: this.scenario,
      contract: this.contract(),
      artifacts,
      verification: this.verifier.verify(this.scenario, artifacts),
      daemons: this.daemonRegistrations().map((registration) => registration.spec.name)
    };
  }
}
