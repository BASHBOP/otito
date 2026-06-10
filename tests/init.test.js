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
  assert.deepEqual(result.created.sort(), [".dev-context/README.md", ".github/workflows/repoctx-ci.yml", ".gitignore"].sort());

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
  assert.match(workflow, /git fetch origin "\+\$\{\{ github\.base_ref \}\}:refs\/remotes\/origin\/\$\{\{ github\.base_ref \}\}"/);
  assert.match(workflow, /Generate commit review context/);
  assert.match(workflow, /node \.dev-context\/tool\/src\/cli\.js pr \./);

  fs.writeFileSync(generatedWorkflowPath, "custom workflow\n");
  const skipped = initProject(fixture);
  assert.ok(skipped.skipped.includes(".github/workflows/repoctx-ci.yml"));
  assert.equal(fs.readFileSync(generatedWorkflowPath, "utf8"), "custom workflow\n");
});

test("initProject adds .dev-context/ to .gitignore (creating it when absent)", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-init-gitignore-"));
  const result = initProject(fixture, { noWorkflow: true });

  const gitignorePath = path.join(fixture, ".gitignore");
  assert.ok(fs.existsSync(gitignorePath), ".gitignore must be created");
  const contents = fs.readFileSync(gitignorePath, "utf8");
  assert.match(contents, /^\.dev-context\/$/m);
  assert.ok(result.created.includes(".gitignore"));
});

test("initProject appends .dev-context/ to an existing .gitignore without clobbering it", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-init-gitignore-"));
  const gitignorePath = path.join(fixture, ".gitignore");
  fs.writeFileSync(gitignorePath, "node_modules\ndist\n");

  const result = initProject(fixture, { noWorkflow: true });
  const contents = fs.readFileSync(gitignorePath, "utf8");
  assert.match(contents, /node_modules/);
  assert.match(contents, /dist/);
  assert.match(contents, /^\.dev-context\/$/m);
  assert.ok(result.updated.includes(".gitignore"));
});

test("initProject is idempotent about .gitignore and respects covering patterns", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-init-gitignore-"));
  const gitignorePath = path.join(fixture, ".gitignore");

  initProject(fixture, { noWorkflow: true });
  const afterFirst = fs.readFileSync(gitignorePath, "utf8");
  const second = initProject(fixture, { noWorkflow: true });
  const afterSecond = fs.readFileSync(gitignorePath, "utf8");

  assert.equal(afterFirst, afterSecond, "second run must not duplicate the entry");
  assert.ok(second.skipped.includes(".gitignore"));

  // A bare ".dev-context" (no trailing slash) already covers the directory.
  const covered = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-init-gitignore-"));
  fs.writeFileSync(path.join(covered, ".gitignore"), ".dev-context\n");
  const result = initProject(covered, { noWorkflow: true });
  assert.equal(fs.readFileSync(path.join(covered, ".gitignore"), "utf8"), ".dev-context\n");
  assert.ok(result.skipped.includes(".gitignore"));
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
