import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runEval } from "../src/lib/eval.js";

test("runEval returns per-task and total token estimates for a tiny repo", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repoctx-eval-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "eval-fixture",
      scripts: { lint: "eslint .", test: "node --test" },
    }),
  );
  fs.writeFileSync(path.join(root, "README.md"), "# eval fixture\n\nA tiny repo for eval testing.\n");
  fs.writeFileSync(path.join(root, "src", "main.ts"), "export function main() { return 42; }\n");

  const { data, markdown } = runEval(root, { query: "audit this codebase" });

  assert.equal(data.ok, true);
  assert.equal(data.evalVersion, 1);
  assert.equal(data.repo.name, path.basename(root));
  assert.equal(data.query, "audit this codebase");
  assert.equal(data.tasks.length, 4);

  const taskNames = data.tasks.map((t) => t.name).sort();
  assert.deepEqual(taskNames, ["code_map", "context_pack", "harness", "repo_overview"]);

  for (const task of data.tasks) {
    assert.equal(task.ok, true, `task ${task.name} should run cleanly: ${task.error}`);
    assert.ok(task.repoctxBytes >= 0);
    assert.ok(task.naiveBytes >= 0);
    assert.ok(task.repoctxTokens >= 0);
    assert.ok(task.naiveTokens >= 0);
  }

  assert.ok(data.totals.repoctxBytes > 0);
  assert.equal(data.totals.repoctxTokens + data.totals.savedTokens, data.totals.naiveTokens, "repoctx + saved should equal naive");

  assert.match(markdown, /# repoctx Eval:/);
  assert.match(markdown, /\| Task \| repoctx tokens \|/);
  assert.match(markdown, /## Totals/);
});

test("runEval handles a missing repo gracefully", () => {
  assert.throws(() => runEval("/this/path/should/not/exist"), /repo not found/);
});
