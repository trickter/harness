import { execFile } from "node:child_process";
import { PermissionPolicy } from "../core/PermissionPolicy.js";

export interface ShellRunRequest {
  command: string;
  args?: string[];
  cwd?: string;
  operation: string;
  artifacts?: string[];
  externalNetwork?: boolean;
}

export interface ShellRunResult {
  exitCode: number;
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

    return new Promise((resolve, reject) => {
      execFile(
        request.command,
        request.args ?? [],
        {
          cwd: request.cwd,
          windowsHide: true
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ exitCode: 0, stdout, stderr });
            return;
          }

          if (typeof error.code === "number") {
            resolve({ exitCode: error.code, stdout, stderr });
            return;
          }

          reject(error);
        }
      );
    });
  }

  async runLine(request: Omit<ShellRunRequest, "command" | "args"> & { commandLine: string }): Promise<ShellRunResult> {
    const shellCommand =
      process.platform === "win32"
        ? { command: "cmd.exe", args: ["/d", "/s", "/c", request.commandLine] }
        : { command: "sh", args: ["-c", request.commandLine] };

    return this.run({
      command: shellCommand.command,
      args: shellCommand.args,
      cwd: request.cwd,
      operation: request.operation,
      artifacts: request.artifacts,
      externalNetwork: request.externalNetwork
    });
  }
}
