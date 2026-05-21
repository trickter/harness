import type { Skill } from "./SkillContext.js";

export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  register(skill: Skill): void {
    if (this.skills.has(skill.name)) {
      throw new Error(`skill ${skill.name} is already registered`);
    }

    this.skills.set(skill.name, skill);
  }

  get(name: string): Skill {
    const skill = this.skills.get(name);

    if (!skill) {
      throw new Error(`skill ${name} is not registered`);
    }

    return skill;
  }

  list(): string[] {
    return [...this.skills.keys()].sort();
  }
}
