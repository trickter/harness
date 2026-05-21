import type { HarnessContext } from "../core/LoopController.js";
import type { AutonomousPlan, AutonomousSupervisor, SupervisorDecision } from "./AutonomousTypes.js";

export class ContractSupervisorAgent implements AutonomousSupervisor {
  async review(plan: AutonomousPlan, context: HarnessContext): Promise<SupervisorDecision> {
    if (!plan.action.summary.trim() || !plan.action.prompt.trim()) {
      return {
        approved: false,
        requiresHuman: true,
        reason: "planner action must have a summary and worker prompt"
      };
    }

    const permission = context.permissions.evaluate({
      operation: plan.action.operation,
      artifacts: plan.action.artifacts,
      destructive: plan.action.destructive,
      externalNetwork: plan.action.externalNetwork,
      secretAccess: plan.action.secretAccess
    });

    return {
      approved: permission.allowed,
      requiresHuman: !permission.allowed,
      reason: permission.reason
    };
  }
}
