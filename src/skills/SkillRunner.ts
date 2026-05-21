import type { SkillContext } from "./SkillContext.js";
import { SkillRegistry } from "./SkillRegistry.js";

export class SkillRunner {
  readonly registry: SkillRegistry;

  constructor(registry: SkillRegistry) {
    this.registry = registry;
  }

  async run<I, O>(name: string, input: I, context: SkillContext): Promise<O> {
    const skill = this.registry.get(name);
    return (await skill.run(input, context)) as O;
  }
}
