import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PermissionPolicy } from "../core/PermissionPolicy.js";

const execFileAsync = promisify(execFile);

export interface ShellRunRequest {
  command: string;
  args?: string[];
  cwd?: string;
  operation: string;
  artifacts?: string[];
  externalNetwork?: boolean;
}

export interface ShellRunResult {
  stdout: string;
  stderr: string;
}

export class ShellAdapter {
  readonly permissions: PermissionPolicy;

  constructor(permissions: PermissionPolicy) {
    this.permissions = permissions;
  }

  async run(request: ShellRunRequest): Promise<ShellRunResult> {
    this.permissions.assertAllowed({
      operation: request.operation,
      artifacts: request.artifacts,
      externalNetwork: request.externalNetwork
    });

    const result = await execFileAsync(request.command, request.args ?? [], {
      cwd: request.cwd,
      windowsHide: true
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr
    };
  }
}
