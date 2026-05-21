import type { SkillContext } from "./SkillContext.js";
import { SkillRegistry } from "./SkillRegistry.js";
import { schemaForSkill } from "./SkillSchemas.js";

export class SkillRunner {
  readonly registry: SkillRegistry;

  constructor(registry: SkillRegistry) {
    this.registry = registry;
  }

  async run<I, O>(name: string, input: I, context: SkillContext): Promise<O> {
    const skill = this.registry.get(name);
    const output = await skill.run(input, context);
    const outputSchema = skill.outputSchema ?? schemaForSkill(skill.name);

    return (outputSchema ? outputSchema.parse(output) : output) as O;
  }
}
