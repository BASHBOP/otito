import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initProject } from "../src/lib/init.js";

test("initProject scaffolds repoctx files without overwriting by default", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-init-"));
  const result = initProject(fixture, { toolRepo: "example/repoctx", toolRef: "stable" });

  assert.equal(result.ok, true);
  assert.deepEqual(result.created.sort(), [".dev-context/README.md", ".github/workflows/repoctx-ci.yml"].sort());

  const generatedWorkflowPath = path.join(fixture, ".github", "workflows", "repoctx-ci.yml");
  const workflow = fs.readFileSync(generatedWorkflowPath, "utf8");
  assert.match(workflow, /repository: example\/repoctx/);
  assert.match(workflow, /ref: stable/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /Checkout PR head/);
  assert.match(workflow, /if: github\.event_name == 'pull_request'/);
  assert.match(workflow, /Checkout pushed commit/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /Install repoctx dependencies/);
  assert.match(workflow, /working-directory: \.dev-context\/tool/);
  assert.match(workflow, /Generate commit review context/);
  assert.match(workflow, /node \.dev-context\/tool\/src\/cli\.js pr \./);

  fs.writeFileSync(generatedWorkflowPath, "custom workflow\n");
  const skipped = initProject(fixture);
  assert.ok(skipped.skipped.includes(".github/workflows/repoctx-ci.yml"));
  assert.equal(fs.readFileSync(generatedWorkflowPath, "utf8"), "custom workflow\n");
});

test("initProject can force overwrite and skip workflow", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-init-"));
  initProject(fixture);

  const forced = initProject(fixture, { force: true });
  assert.ok(forced.updated.includes(".dev-context/README.md"));
  assert.ok(forced.updated.includes(".github/workflows/repoctx-ci.yml"));

  const noWorkflow = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-init-"));
  const result = initProject(noWorkflow, { noWorkflow: true });
  assert.ok(result.created.includes(".dev-context/README.md"));
  assert.equal(fs.existsSync(path.join(noWorkflow, ".github", "workflows", "repoctx-ci.yml")), false);
});
