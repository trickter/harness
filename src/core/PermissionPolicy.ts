import type { GoalContract } from "./GoalContract.js";

export interface ActionRequest {
  operation: string;
  artifacts?: string[];
  destructive?: boolean;
  externalNetwork?: boolean;
  secretAccess?: boolean;
  approvalGranted?: boolean;
}

export interface PermissionDecision {
  allowed: boolean;
  requiresHuman: boolean;
  reason: string;
  violations: string[];
}

export class PermissionDeniedError extends Error {
  readonly decision: PermissionDecision;

  constructor(decision: PermissionDecision) {
    super(decision.reason);
    this.name = "PermissionDeniedError";
    this.decision = decision;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function matchesPattern(value: string, pattern: string): boolean {
  const normalizedValue = value.replaceAll("\\", "/");
  const normalizedPattern = pattern.replaceAll("\\", "/");
  const regex = escapeRegex(normalizedPattern)
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]*")
    .replaceAll("\0", ".*");

  return new RegExp(`^${regex}$`).test(normalizedValue);
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPattern(value, pattern));
}

export class PermissionPolicy {
  readonly contract: GoalContract;

  constructor(contract: GoalContract) {
    this.contract = contract;
  }

  evaluate(action: ActionRequest): PermissionDecision {
    const violations: string[] = [];
    let requiresHuman = false;

    if (matchesAny(action.operation, this.contract.scope.forbiddenOperations)) {
      violations.push(`operation ${action.operation} is forbidden by scope`);
    }

    if (!matchesAny(action.operation, this.contract.scope.allowedOperations)) {
      violations.push(`operation ${action.operation} is not explicitly allowed`);
    }

    for (const artifact of action.artifacts ?? []) {
      if (matchesAny(artifact, this.contract.scope.forbiddenArtifacts)) {
        violations.push(`artifact ${artifact} is forbidden by scope`);
      }

      if (!matchesAny(artifact, this.contract.scope.allowedArtifacts)) {
        violations.push(`artifact ${artifact} is not explicitly allowed`);
      }
    }

    if (action.destructive) {
      const destructivePolicy = this.contract.riskPolicy.destructiveActions;

      if (destructivePolicy === "forbidden") {
        violations.push("destructive actions are forbidden");
      }

      if (destructivePolicy === "require_explicit_approval" && !action.approvalGranted) {
        requiresHuman = true;
        violations.push("destructive action requires explicit approval");
      }
    }

    if (action.externalNetwork) {
      if (this.contract.riskPolicy.externalNetwork === "forbidden") {
        violations.push("external network access is forbidden");
      } else if (
        this.contract.riskPolicy.externalNetwork === "restricted" &&
        !action.approvalGranted
      ) {
        requiresHuman = true;
        violations.push("restricted external network access requires explicit approval");
      }
    }

    if (action.secretAccess) {
      if (this.contract.riskPolicy.secretAccess === "forbidden") {
        violations.push("secret access is forbidden");
      } else if (!action.approvalGranted) {
        requiresHuman = true;
        violations.push("restricted secret access requires explicit approval");
      }
    }

    if (violations.length > 0) {
      return {
        allowed: false,
        requiresHuman,
        reason: violations.join("; "),
        violations
      };
    }

    return {
      allowed: true,
      requiresHuman: false,
      reason: "action is allowed by contract scope and risk policy",
      violations: []
    };
  }

  assertAllowed(action: ActionRequest): void {
    const decision = this.evaluate(action);

    if (!decision.allowed) {
      throw new PermissionDeniedError(decision);
    }
  }
}
