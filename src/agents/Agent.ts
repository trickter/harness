import type { HarnessContext } from "../core/LoopController.js";

export interface Agent<I = unknown, O = unknown> {
  name: string;
  role: string;
  allowedActions: string[];
  forbiddenActions: string[];
  run(input: I, context: HarnessContext): Promise<O>;
}
