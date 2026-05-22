import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ShellAdapter } from "../src/adapters/ShellAdapter.js";
import { parseGoalContract } from "../src/core/GoalContract.js";
import { PermissionPolicy } from "../src/core/PermissionPolicy.js";

const shellContract = parseGoalContract({
  goal: {
    id: "shell",
    name: "Shell",
    objective: "Run verification commands."
  },
  scope: {
    allowedArtifacts: [],
    forbiddenArtifacts: [],
    allowedOperations: ["shell:verify"],
    forbiddenOperations: []
  }
});

test("shell adapter returns output and exit code for failed verification commands", async () => {
  const shell = new ShellAdapter(new PermissionPolicy(shellContract));
  const result = await shell.run({
    command: process.execPath,
    args: [
      "-e",
      "process.stdout.write('verify-out'); process.stderr.write('verify-err'); process.exit(3);"
    ],
    operation: "shell:verify"
  });

  assert.equal(result.exitCode, 3);
  assert.equal(result.stdout, "verify-out");
  assert.equal(result.stderr, "verify-err");
});

test("shell adapter throws when the command cannot be spawned", async () => {
  const shell = new ShellAdapter(new PermissionPolicy(shellContract), {
    allowedCommands: ["definitely-missing-harness-command"]
  });

  await assert.rejects(
    shell.run({
      command: "definitely-missing-harness-command",
      operation: "shell:verify"
    })
  );
});

test("shell adapter denies command-line control operators and git pushes hidden behind shell scope", async () => {
  const shell = new ShellAdapter(new PermissionPolicy(shellContract));
  const commitContract = parseGoalContract({
    goal: {
      id: "shell-git-commit",
      name: "Shell Git Commit",
      objective: "Commit a bounded change."
    },
    scope: {
      allowedArtifacts: [],
      forbiddenArtifacts: [],
      allowedOperations: ["shell:verify", "git:commit"],
      forbiddenOperations: []
    },
    riskPolicy: {
      destructiveActions: "require_explicit_approval",
      externalNetwork: "forbidden",
      secretAccess: "forbidden"
    }
  });

  await assert.rejects(
    shell.runLine({
      commandLine: "node verify.cjs && git push origin main",
      operation: "shell:verify"
    }),
    /control operators/
  );
  await assert.rejects(
    shell.run({
      command: "git",
      args: ["push", "origin", "main"],
      operation: "shell:verify"
    }),
    /git:push/
  );
  await assert.rejects(
    new ShellAdapter(new PermissionPolicy(commitContract)).run({
      command: "git",
      args: ["commit", "--allow-empty", "-m", "bounded"],
      operation: "shell:verify"
    }),
    /explicit approval/
  );
});

test("shell adapter keeps cwd inside the workspace and strips secret environment variables", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-shell-workspace-"));
  const outside = await mkdtemp(join(tmpdir(), "harness-shell-outside-"));
  const priorSecret = process.env.HARNESS_TEST_SECRET;
  const shell = new ShellAdapter(new PermissionPolicy(shellContract), { workspaceRoot: workspace });

  process.env.HARNESS_TEST_SECRET = "do-not-leak";

  try {
    const result = await shell.run({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.env.HARNESS_TEST_SECRET ?? 'missing')"],
      cwd: workspace,
      operation: "shell:verify"
    });

    assert.equal(result.stdout, "missing");
    await assert.rejects(
      shell.run({
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        cwd: outside,
        operation: "shell:verify"
      }),
      /escapes workspace/
    );
  } finally {
    if (priorSecret === undefined) {
      delete process.env.HARNESS_TEST_SECRET;
    } else {
      process.env.HARNESS_TEST_SECRET = priorSecret;
    }
  }
});

test("shell adapter enforces allowlisted network hosts", async () => {
  const networkContract = parseGoalContract({
    goal: {
      id: "shell-network",
      name: "Shell Network",
      objective: "Fetch an approved URL."
    },
    scope: {
      allowedArtifacts: [],
      forbiddenArtifacts: [],
      allowedOperations: ["shell:fetch"],
      forbiddenOperations: []
    },
    riskPolicy: {
      destructiveActions: "forbidden",
      externalNetwork: "allowed",
      secretAccess: "forbidden"
    }
  });
  const shell = new ShellAdapter(new PermissionPolicy(networkContract), {
    allowedCommands: ["curl"],
    allowedNetworkHosts: ["allowed.example"]
  });

  await assert.rejects(
    shell.run({
      command: "curl",
      args: ["https://blocked.example/data.json"],
      operation: "shell:fetch"
    }),
    /not allowlisted/
  );
});
