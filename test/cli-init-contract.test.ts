import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parseGoalContractText } from "../src/core/GoalContract.js";

const execFileAsync = promisify(execFile);

test("CLI init-contract infers verification and scope from a natural-language objective", async () => {
  const result = await execFileAsync(process.execPath, [
    join(process.cwd(), "dist", "src", "cli", "index.js"),
    "init-contract",
    "--name",
    "Python Parser Fix",
    "--objective",
    "Fix the Python parser bug in src/parser.py and verify with `pytest tests/test_parser.py`."
  ]);
  const contract = parseGoalContractText(result.stdout);

  assert.deepEqual(contract.verification.commands, ["pytest tests/test_parser.py"]);
  assert.ok(contract.goal.expectedOutputs.includes("src/parser.py"));
  assert.ok(contract.scope.allowedArtifacts.includes("test/**"));
  assert.ok(contract.successCriteria.length > 0);
  assert.equal(contract.riskPolicy.profile, "workspace");
});
