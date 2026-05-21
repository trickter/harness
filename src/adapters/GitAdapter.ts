import { ShellAdapter } from "./ShellAdapter.js";

export class GitAdapter {
  readonly shell: ShellAdapter;

  constructor(shell: ShellAdapter) {
    this.shell = shell;
  }

  async status(cwd: string): Promise<string> {
    const result = await this.shell.run({
      command: "git",
      args: ["status", "--short"],
      cwd,
      operation: "git:status"
    });

    return result.stdout;
  }

  async diff(cwd: string): Promise<string> {
    const result = await this.shell.run({
      command: "git",
      args: ["diff", "--"],
      cwd,
      operation: "git:diff"
    });

    return result.stdout;
  }
}
