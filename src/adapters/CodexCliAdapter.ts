import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type CodexSandboxMode = "read-only" | "workspace-write";

export interface CodexStructuredTaskRequest {
  cwd: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
  sandbox: CodexSandboxMode;
  model?: string;
}

export interface CodexCliAdapterOptions {
  binary?: string;
  model?: string;
}

function runCodex(binary: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true
      },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        resolve();
      }
    );
  });
}

export class CodexCliAdapter {
  readonly binary: string;
  readonly model?: string;

  constructor(options: CodexCliAdapterOptions = {}) {
    this.binary = options.binary ?? "codex";
    this.model = options.model;
  }

  async runStructured<T>(request: CodexStructuredTaskRequest): Promise<T> {
    const directory = await mkdtemp(join(tmpdir(), "harness-codex-"));
    const schemaPath = join(directory, "output-schema.json");
    const outputPath = join(directory, "last-message.json");

    try {
      await writeFile(schemaPath, JSON.stringify(request.outputSchema), "utf8");

      const args = [
        "-a",
        "never",
        "exec",
        "--ephemeral",
        "--sandbox",
        request.sandbox,
        "--cd",
        request.cwd,
        "--skip-git-repo-check",
        "--color",
        "never",
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath
      ];
      const model = request.model ?? this.model;

      if (model) {
        args.push("--model", model);
      }

      args.push(request.prompt);
      await runCodex(this.binary, args, request.cwd);

      return JSON.parse(await readFile(outputPath, "utf8")) as T;
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
}
