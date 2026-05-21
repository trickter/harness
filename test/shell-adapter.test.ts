import assert from "node:assert/strict";
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
  const shell = new ShellAdapter(new PermissionPolicy(shellContract));

  await assert.rejects(
    shell.run({
      command: "definitely-missing-harness-command",
      operation: "shell:verify"
    })
  );
});
