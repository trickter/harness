import { execFile } from "node:child_process";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { PermissionPolicy } from "../core/PermissionPolicy.js";

export interface ShellRunRequest {
  command: string;
  args?: string[];
  cwd?: string;
  operation: string;
  artifacts?: string[];
  destructive?: boolean;
  externalNetwork?: boolean;
  secretAccess?: boolean;
  approvalGranted?: boolean;
}

export interface ShellRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ShellAdapterOptions {
  workspaceRoot?: string;
  allowedCommands?: string[];
  allowedNetworkHosts?: string[];
}

export class ShellSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShellSecurityError";
  }
}

const DEFAULT_ALLOWED_COMMANDS = [
  "cargo",
  "eslint",
  "git",
  "go",
  "jest",
  "node",
  "npm",
  "npx",
  "pnpm",
  "pytest",
  "python",
  "python3",
  "tsc",
  "uv",
  "vitest",
  "yarn"
];
const DANGEROUS_COMMANDS = new Set([
  "bash",
  "cmd",
  "cmd.exe",
  "del",
  "dd",
  "format",
  "mkfs",
  "powershell",
  "pwsh",
  "rm",
  "rmdir",
  "sh",
  "shutdown"
]);
const SHELL_CONTROL_PATTERN = /(?:&&|\|\||[|;<>]|`|\$\(|\r|\n)/u;
const SECRET_REFERENCE_PATTERN = /(?:^|[\\/])(?:\.env(?:\.[^\\/]+)?|secrets?)(?:[\\/]|$)/iu;
const SAFE_ENV_KEYS = [
  "CI",
  "HOME",
  "LANG",
  "LC_ALL",
  "NODE_ENV",
  "PATH",
  "PATHEXT",
  "SystemDrive",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR"
] as const;

function executableName(command: string): string {
  const name = basename(command).toLowerCase();

  return name.replace(/\.(?:cmd|exe|bat)$/u, "");
}

function safeEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    SAFE_ENV_KEYS.flatMap((key) => {
      const value = process.env[key];

      return value === undefined ? [] : [[key, value]];
    })
  );
}

function withinWorkspace(root: string, cwd: string): boolean {
  const path = relative(root, cwd);

  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function networkHosts(args: string[]): string[] {
  return args.flatMap((arg) => {
    try {
      const url = new URL(arg);

      return url.hostname ? [url.hostname.toLowerCase()] : [];
    } catch {
      return [];
    }
  });
}

function usesImplicitNetwork(command: string, args: string[]): boolean {
  const name = executableName(command);
  const verb = args[0]?.toLowerCase();

  if (["curl", "pip", "wget"].includes(name)) {
    return true;
  }

  if (name === "git") {
    return ["clone", "fetch", "pull", "push"].includes(verb ?? "");
  }

  if (["npm", "npx", "pnpm", "yarn"].includes(name)) {
    return ["add", "audit", "install", "publish", "upgrade"].includes(verb ?? "");
  }

  if (name === "uv") {
    return ["add", "pip", "sync"].includes(verb ?? "");
  }

  return false;
}

function referencesSecrets(values: string[]): boolean {
  return values.some((value) => SECRET_REFERENCE_PATTERN.test(value.replaceAll("\\", "/")));
}

function gitOperation(command: string, args: string[]): "git:commit" | "git:push" | undefined {
  if (executableName(command) !== "git") {
    return undefined;
  }

  const verb = args[0]?.toLowerCase();

  if (verb === "commit") {
    return "git:commit";
  }

  if (verb === "push") {
    return "git:push";
  }

  return undefined;
}

function usesInlineInterpreter(command: string, args: string[]): boolean {
  const name = executableName(command);
  const inlineFlags = new Set(["-c", "-e", "-p", "--eval", "--print", "--command"]);

  if (["node", "python", "python3"].includes(name)) {
    return args.some((arg) => inlineFlags.has(arg));
  }

  return false;
}

function parseCommandLine(commandLine: string): { command: string; args: string[] } {
  if (SHELL_CONTROL_PATTERN.test(commandLine)) {
    throw new ShellSecurityError("shell command line contains control operators or redirection");
  }

  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;

  const trimmed = commandLine.trim();

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index] ?? "";
    const next = trimmed[index + 1];

    if (character === "\\" && quote === '"' && (next === '"' || next === "\\")) {
      current += next;
      index += 1;
      continue;
    }

    if ((character === "'" || character === '"') && (!quote || quote === character)) {
      quote = quote ? undefined : character;
      continue;
    }

    if (/\s/u.test(character) && !quote) {
      if (current) {
        tokens.push(current);
        current = "";
      }

      continue;
    }

    current += character;
  }

  if (quote) {
    throw new ShellSecurityError("shell command line has an unterminated quote");
  }

  if (current) {
    tokens.push(current);
  }

  const [command, ...args] = tokens;

  if (!command) {
    throw new ShellSecurityError("shell command line is empty");
  }

  return { command, args };
}

export class ShellAdapter {
  readonly permissions: PermissionPolicy;
  readonly workspaceRoot?: string;
  readonly allowedCommands: Set<string>;
  readonly allowedNetworkHosts: Set<string>;

  constructor(permissions: PermissionPolicy, options: ShellAdapterOptions = {}) {
    this.permissions = permissions;
    this.workspaceRoot = options.workspaceRoot ? resolve(options.workspaceRoot) : undefined;
    this.allowedCommands = new Set((options.allowedCommands ?? DEFAULT_ALLOWED_COMMANDS).map(executableName));
    this.allowedNetworkHosts = new Set((options.allowedNetworkHosts ?? []).map((host) => host.toLowerCase()));
  }

  async run(request: ShellRunRequest): Promise<ShellRunResult> {
    const args = request.args ?? [];

    this.assertCommandBoundary(request.command, args, request.cwd);
    const gitAction = gitOperation(request.command, args);

    if (gitAction) {
      this.permissions.assertAllowed({
        operation: gitAction,
        destructive: true,
        approvalGranted: request.approvalGranted
      });
    }

    this.assertNetworkBoundary(request.command, args, request.externalNetwork);
    this.permissions.assertAllowed({
      operation: request.operation,
      artifacts: request.artifacts,
      destructive: request.destructive,
      externalNetwork: request.externalNetwork || usesImplicitNetwork(request.command, args),
      secretAccess: request.secretAccess || referencesSecrets([request.command, ...args]),
      approvalGranted: request.approvalGranted
    });

    return new Promise((resolveRun, reject) => {
      execFile(
        request.command,
        args,
        {
          cwd: request.cwd,
          env: safeEnvironment(),
          windowsHide: true
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolveRun({ exitCode: 0, stdout, stderr });
            return;
          }

          if (typeof error.code === "number") {
            resolveRun({ exitCode: error.code, stdout, stderr });
            return;
          }

          reject(error);
        }
      );
    });
  }

  async runLine(request: Omit<ShellRunRequest, "command" | "args"> & { commandLine: string }): Promise<ShellRunResult> {
    const parsed = parseCommandLine(request.commandLine);

    return this.run({
      ...request,
      command: parsed.command,
      args: parsed.args
    });
  }

  private assertCommandBoundary(command: string, args: string[], cwd: string | undefined): void {
    const name = executableName(command);

    if (DANGEROUS_COMMANDS.has(name)) {
      throw new ShellSecurityError(`shell command ${name} is denied as dangerous`);
    }

    if (!this.allowedCommands.has(name)) {
      throw new ShellSecurityError(`shell command ${name} is not in the allowlist`);
    }

    if (name === "git" && ["clean", "reset"].includes(args[0]?.toLowerCase() ?? "")) {
      throw new ShellSecurityError(`git ${args[0]} is denied as dangerous`);
    }

    if (usesInlineInterpreter(command, args)) {
      throw new ShellSecurityError(`shell command ${name} cannot execute inline interpreter code`);
    }

    if (this.workspaceRoot) {
      const resolvedCwd = resolve(cwd ?? this.workspaceRoot);

      if (!withinWorkspace(this.workspaceRoot, resolvedCwd)) {
        throw new ShellSecurityError(`shell cwd ${resolvedCwd} escapes workspace ${this.workspaceRoot}`);
      }
    }
  }

  private assertNetworkBoundary(command: string, args: string[], externalNetwork: boolean | undefined): void {
    const network = Boolean(externalNetwork || usesImplicitNetwork(command, args));

    if (!network) {
      return;
    }

    const hosts = networkHosts(args);

    if (hosts.length === 0) {
      throw new ShellSecurityError("external network command must declare explicit URL hosts");
    }

    const denied = hosts.filter((host) => !this.allowedNetworkHosts.has(host));

    if (denied.length > 0) {
      throw new ShellSecurityError(`external network host is not allowlisted: ${denied.join(", ")}`);
    }
  }
}
