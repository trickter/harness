import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { z } from "zod";
import { schemaForSkill } from "./SkillSchemas.js";

export interface LocalSkillDocument {
  name: string;
  description: string;
  path: string;
  skillPath: string;
  body: string;
  frontmatter: Record<string, unknown>;
  references: string[];
  outputSchema?: z.ZodType;
}

function parseFrontmatter(markdown: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u);

  if (!match) {
    throw new Error("SKILL.md is missing YAML frontmatter");
  }

  const frontmatter = parseYaml(match[1] ?? "");

  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    throw new Error("SKILL.md frontmatter must be a YAML object");
  }

  return {
    frontmatter: frontmatter as Record<string, unknown>,
    body: match[2] ?? ""
  };
}

function stringField(frontmatter: Record<string, unknown>, field: string): string {
  const value = frontmatter[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`SKILL.md frontmatter must include ${field}`);
  }

  return value.trim();
}

function referencedLocalMarkdown(body: string): string[] {
  return [...body.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/gu)]
    .map((match) => match[1]?.trim())
    .filter((reference): reference is string => Boolean(reference))
    .filter((reference) => !/^[a-z]+:\/\//iu.test(reference));
}

export async function loadLocalSkill(skillPath: string): Promise<LocalSkillDocument> {
  const resolvedPath = resolve(skillPath);
  const path = join(resolvedPath, "SKILL.md");
  const markdown = await readFile(path, "utf8");
  const { frontmatter, body } = parseFrontmatter(markdown);
  const name = stringField(frontmatter, "name");

  return {
    name,
    description: stringField(frontmatter, "description"),
    path,
    skillPath: resolvedPath,
    body,
    frontmatter,
    references: referencedLocalMarkdown(body),
    outputSchema: schemaForSkill(name)
  };
}

export async function loadLocalSkills(root: string): Promise<LocalSkillDocument[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => loadLocalSkill(join(root, entry.name)))
  );

  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

export function expectedSkillDirectory(skill: LocalSkillDocument): string {
  return basename(skill.skillPath);
}
