import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initProject } from "../src/lib/init.js";

test("initProject scaffolds dev-context files without overwriting by default", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-init-"));
  const result = initProject(fixture, { toolRepo: "example/dev-context", toolRef: "stable" });

  assert.equal(result.ok, true);
  assert.deepEqual(result.created.sort(), [
    ".dev-context/README.md",
    ".github/workflows/dev-context-pr.yml"
  ].sort());

  const workflowPath = path.join(fixture, ".github", "workflows", "dev-context-pr.yml");
  const workflow = fs.readFileSync(workflowPath, "utf8");
  assert.match(workflow, /repository: example\/dev-context/);
  assert.match(workflow, /ref: stable/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /Checkout PR head/);
  assert.match(workflow, /if: github\.event_name == 'pull_request'/);
  assert.match(workflow, /Checkout pushed commit/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /Generate commit review context/);
  assert.match(workflow, /node \.dev-context\/tool\/src\/cli\.js pr \./);

  fs.writeFileSync(workflowPath, "custom workflow\n");
  const skipped = initProject(fixture);
  assert.ok(skipped.skipped.includes(".github/workflows/dev-context-pr.yml"));
  assert.equal(fs.readFileSync(workflowPath, "utf8"), "custom workflow\n");
});

test("initProject can force overwrite and skip workflow", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-init-"));
  initProject(fixture);

  const forced = initProject(fixture, { force: true });
  assert.ok(forced.updated.includes(".dev-context/README.md"));
  assert.ok(forced.updated.includes(".github/workflows/dev-context-pr.yml"));

  const noWorkflow = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-init-"));
  const result = initProject(noWorkflow, { noWorkflow: true });
  assert.ok(result.created.includes(".dev-context/README.md"));
  assert.equal(fs.existsSync(path.join(noWorkflow, ".github", "workflows", "dev-context-pr.yml")), false);
});
