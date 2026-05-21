import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LocalSkillDocument } from "./SkillLoader.js";
import { expectedSkillDirectory, loadLocalSkills } from "./SkillLoader.js";

export type SkillValidationSeverity = "error" | "warning";

export interface SkillValidationFinding {
  skill: string;
  severity: SkillValidationSeverity;
  code: string;
  message: string;
}

export interface SkillValidationEntry {
  name: string;
  path: string;
  description: string;
  references: string[];
  outputSchema: boolean;
  valid: boolean;
  findings: SkillValidationFinding[];
}

export interface SkillValidationReport {
  generatedAt: string;
  root: string;
  valid: boolean;
  skillCount: number;
  schemaCount: number;
  skills: SkillValidationEntry[];
  findings: SkillValidationFinding[];
}

const REQUIRED_SKILL_REFERENCES: Record<string, string> = {
  "goal-contract-skill": "references/goal-contract-schema.md",
  "planning-skill": "references/planning-output.md",
  "execution-skill": "references/action-result.md",
  "verification-skill": "references/verification-result.md",
  "progress-evaluator-skill": "references/progress-decision.md",
  "escape-divergence-skill": "references/escape-output.md",
  "supervisor-skill": "references/supervisor-decision.md",
  "daemon-agent-skill": "references/daemon-spec.md",
  "artifact-modeling-skill": "references/artifact-graph.md",
  "recovery-skill": "references/recovery-report.md",
  "data-analysis-skill": "references/data-analysis-output.md",
  "auto-modeling-skill": "references/auto-modeling-output.md",
  "model-optimization-skill": "references/model-optimization-output.md"
};

const AUTONOMOUS_REQUIRED_MARKERS = [
  "current Codex session is the agent",
  "Do not use `harness codex-run`",
  "harness start",
  "harness status",
  "harness turn",
  "harness audit",
  "harness verify",
  "harness recover"
];

function finding(
  skill: string,
  severity: SkillValidationSeverity,
  code: string,
  message: string
): SkillValidationFinding {
  return { skill, severity, code, message };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function validateReference(skill: LocalSkillDocument, reference: string): Promise<SkillValidationFinding[]> {
  return (await fileExists(join(skill.skillPath, reference)))
    ? []
    : [finding(skill.name, "error", "missing-reference", `Referenced skill file ${reference} does not exist.`)];
}

async function validateSkill(skill: LocalSkillDocument): Promise<SkillValidationEntry> {
  const findings: SkillValidationFinding[] = [];

  if (expectedSkillDirectory(skill) !== skill.name) {
    findings.push(
      finding(
        skill.name,
        "error",
        "directory-name-mismatch",
        `Skill directory ${expectedSkillDirectory(skill)} must match frontmatter name ${skill.name}.`
      )
    );
  }

  for (const reference of skill.references) {
    findings.push(...(await validateReference(skill, reference)));
  }

  const requiredReference = REQUIRED_SKILL_REFERENCES[skill.name];

  if (requiredReference && !skill.references.includes(requiredReference)) {
    findings.push(
      finding(
        skill.name,
        "error",
        "missing-output-reference",
        `Harness skill must link its output reference ${requiredReference}.`
      )
    );
  }

  if (requiredReference && !skill.outputSchema) {
    findings.push(
      finding(skill.name, "error", "missing-output-schema", "Harness skill has no TypeScript output schema.")
    );
  }

  if (skill.name === "autonomous-harness") {
    for (const marker of AUTONOMOUS_REQUIRED_MARKERS) {
      if (!skill.body.includes(marker)) {
        findings.push(
          finding(
            skill.name,
            "error",
            "missing-protocol-marker",
            `Autonomous harness skill must include protocol marker ${JSON.stringify(marker)}.`
          )
        );
      }
    }
  }

  return {
    name: skill.name,
    path: skill.path,
    description: skill.description,
    references: skill.references,
    outputSchema: Boolean(skill.outputSchema),
    valid: !findings.some((entry) => entry.severity === "error"),
    findings
  };
}

export async function validateLocalSkills(root: string): Promise<SkillValidationReport> {
  const skills = await loadLocalSkills(root);
  const entries = await Promise.all(skills.map(validateSkill));
  const findings = entries.flatMap((entry) => entry.findings);

  return {
    generatedAt: new Date().toISOString(),
    root,
    valid: !findings.some((entry) => entry.severity === "error"),
    skillCount: entries.length,
    schemaCount: entries.filter((entry) => entry.outputSchema).length,
    skills: entries,
    findings
  };
}

export async function writeSkillValidationReport(path: string, report: SkillValidationReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
