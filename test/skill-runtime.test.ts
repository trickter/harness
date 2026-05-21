import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { z } from "zod";
import { ArtifactGraph } from "../src/artifacts/ArtifactGraph.js";
import { parseGoalContract } from "../src/core/GoalContract.js";
import { PermissionPolicy } from "../src/core/PermissionPolicy.js";
import type { SkillContext } from "../src/skills/SkillContext.js";
import { loadLocalSkill, loadLocalSkills } from "../src/skills/SkillLoader.js";
import { SkillRegistry } from "../src/skills/SkillRegistry.js";
import { SkillRunner } from "../src/skills/SkillRunner.js";
import { validateLocalSkills } from "../src/skills/SkillValidation.js";

const execFileAsync = promisify(execFile);

function cli(): string {
  return join(process.cwd(), "dist", "src", "cli", "index.js");
}

function context(): SkillContext {
  const contract = parseGoalContract({
    goal: {
      id: "skill-runtime",
      name: "Skill Runtime",
      objective: "Validate skill output."
    }
  });

  return {
    contract,
    phase: "DIVERGE_PLAN",
    ledger: [],
    artifacts: new ArtifactGraph(),
    permissions: new PermissionPolicy(contract)
  };
}

test("skill loader reads local SKILL.md metadata, references, and built-in output schema", async () => {
  const skill = await loadLocalSkill(join(process.cwd(), "skills", "planning-skill"));
  const allSkills = await loadLocalSkills(join(process.cwd(), "skills"));

  assert.equal(skill.name, "planning-skill");
  assert.match(skill.description, /bounded candidate strategies/i);
  assert.deepEqual(skill.references, ["references/planning-output.md"]);
  assert.equal(Boolean(skill.outputSchema), true);
  assert.equal(allSkills.some((entry) => entry.name === "autonomous-harness"), true);
});

test("skill runner rejects outputs that do not satisfy a registered schema", async () => {
  const registry = new SkillRegistry();
  registry.register({
    name: "schema-gated",
    outputSchema: z.object({ ok: z.literal(true) }),
    async run() {
      return { ok: false };
    }
  });

  await assert.rejects(new SkillRunner(registry).run("schema-gated", {}, context()), /Invalid input/);
});

test("skill runner applies built-in schemas for harness skills", async () => {
  const registry = new SkillRegistry();
  registry.register({
    name: "planning-skill",
    async run() {
      return {
        phase: "DIVERGE_PLAN",
        strategies: []
      };
    }
  });

  await assert.rejects(new SkillRunner(registry).run("planning-skill", {}, context()), /Invalid input/);
});

test("skill validation report checks local harness protocol and can be emitted by CLI", async () => {
  const root = join(process.cwd(), "skills");
  const report = await validateLocalSkills(root);
  const directory = await mkdtemp(join(tmpdir(), "harness-skill-report-"));
  const reportPath = join(directory, "skills.json");
  const cliReport = JSON.parse(
    (
      await execFileAsync(process.execPath, [
        cli(),
        "skills",
        "validate",
        "--root",
        root,
        "--report",
        reportPath
      ])
    ).stdout
  ) as { valid: boolean; skillCount: number; schemaCount: number };

  assert.equal(report.valid, true);
  assert.equal(report.skillCount, 10);
  assert.equal(report.schemaCount, 9);
  assert.equal(cliReport.valid, true);
  assert.equal(cliReport.skillCount, 10);
  assert.match(await readFile(reportPath, "utf8"), /autonomous-harness/);
});
