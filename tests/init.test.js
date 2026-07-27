import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { initProject } from "../src/lib/init.js";

test("initProject scaffolds repoctx files without overwriting by default", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-init-"));
  const result = initProject(fixture, { toolRepo: "example/repoctx", toolRef: "stable" });

  assert.equal(result.ok, true);
  assert.deepEqual(result.created.sort(), [".dev-context/README.md", ".githooks/pre-commit", ".github/workflows/repoctx-ci.yml", ".gitignore"].sort());

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

test("initProject injects a harness-driven quality job and pre-commit hook from package scripts", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-init-gates-"));
  fs.writeFileSync(
    path.join(fixture, "package.json"),
    JSON.stringify({ name: "sample", scripts: { lint: "eslint .", typecheck: "tsc --noEmit", test: "node --test" } }, null, 2),
  );

  const result = initProject(fixture);

  assert.equal(result.gatesApplied, true);
  assert.equal(result.gatesStatus, "applied");
  assert.equal(result.precommitApplied, true);
  assert.equal(result.precommitStatus, "applied");
  assert.ok(result.created.includes(".githooks/pre-commit"));

  const workflow = fs.readFileSync(path.join(fixture, ".github", "workflows", "repoctx-ci.yml"), "utf8");
  const qualitySection = workflow.split("  review:")[0];
  assert.match(workflow, /^ {2}quality:$/m);
  assert.match(workflow, /actions\/setup-node@v4/);
  assert.match(qualitySection, /install Node dependencies\n {8}run: npm install/);
  assert.doesNotMatch(qualitySection, /install Node dependencies\n {8}run: npm ci/);
  assert.match(workflow, /run: npm run lint/);
  assert.match(workflow, /run: npm run typecheck/);
  assert.match(workflow, /run: npm test/);
  // the review job must survive alongside the new quality job
  assert.match(workflow, /name: Generate PR review context/);

  const hookFile = path.join(fixture, ".githooks", "pre-commit");
  const hook = fs.readFileSync(hookFile, "utf8");
  assert.match(hook, /^#!\/bin\/sh/);
  assert.match(hook, /npm run lint/);
  assert.match(hook, /npm run typecheck/);
  assert.match(hook, /repoctx gate \. --staged --out \.dev-context\/gate\.md/);
  // slow gates (test/build/audit) never run in the pre-commit hook
  assert.doesNotMatch(hook, /npm test/);
  // the hook must be executable
  assert.equal(fs.statSync(hookFile).mode & 0o111, 0o111);
});

test("initProject omits gates and pre-commit when disabled", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-init-nogates-"));
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ name: "sample", scripts: { lint: "eslint ." } }, null, 2));

  const result = initProject(fixture, { gates: false, precommit: false });

  assert.equal(result.gatesApplied, false);
  assert.equal(result.gatesStatus, "disabled");
  assert.equal(result.precommitApplied, false);
  assert.equal(result.precommitStatus, "disabled");
  assert.equal(fs.existsSync(path.join(fixture, ".githooks", "pre-commit")), false);

  const workflow = fs.readFileSync(path.join(fixture, ".github", "workflows", "repoctx-ci.yml"), "utf8");
  assert.doesNotMatch(workflow, /^ {2}quality:$/m);
  assert.match(workflow, /name: Generate PR review context/);
});

test("initProject installs the staged safety hook even when no static scripts are detected", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-init-bare-"));
  const result = initProject(fixture);

  assert.equal(result.gatesApplied, false);
  assert.equal(result.gatesStatus, "none");
  assert.equal(result.precommitApplied, true);
  assert.equal(result.precommitStatus, "applied");
  const hook = fs.readFileSync(path.join(fixture, ".githooks", "pre-commit"), "utf8");
  assert.match(hook, /repoctx gate \. --staged --out \.dev-context\/gate\.md/);
});

test("initProject uses npm ci when package-lock.json is present", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-init-lock-"));
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ name: "sample", scripts: { lint: "eslint .", test: "node --test" } }, null, 2));
  fs.writeFileSync(path.join(fixture, "package-lock.json"), JSON.stringify({ name: "sample", lockfileVersion: 3, packages: {} }, null, 2));

  initProject(fixture);

  const workflow = fs.readFileSync(path.join(fixture, ".github", "workflows", "repoctx-ci.yml"), "utf8");
  const qualitySection = workflow.split("  review:")[0];
  assert.match(qualitySection, /install Node dependencies\n {8}run: npm ci/);
});

test("initProject excludes non-static script names from the pre-commit hook", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-init-precommit-filter-"));
  fs.writeFileSync(
    path.join(fixture, "package.json"),
    JSON.stringify({ name: "sample", scripts: { lint: "eslint .", prototype: "node prototype.js", test: "node --test" } }, null, 2),
  );

  const result = initProject(fixture);

  assert.equal(result.precommitApplied, true);
  const hook = fs.readFileSync(path.join(fixture, ".githooks", "pre-commit"), "utf8");
  assert.match(hook, /repoctx gate \. --staged --out \.dev-context\/gate\.md/);
  assert.match(hook, /npm run lint/);
  assert.doesNotMatch(hook, /prototype/);
  assert.doesNotMatch(hook, /npm test/);
});

test("initProject sets core.hooksPath only when requested, inside a git repo", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-init-hooks-"));
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ name: "sample", scripts: { lint: "eslint ." } }, null, 2));
  execFileSync("git", ["init"], { cwd: fixture, stdio: "ignore" });

  const result = initProject(fixture, { hooksPath: true });

  assert.equal(result.precommitApplied, true);
  assert.equal(result.hooksConfigured, true);
  const configured = execFileSync("git", ["config", "core.hooksPath"], { cwd: fixture }).toString().trim();
  assert.equal(configured, ".githooks");
});

test("initProject skips hooks path when no pre-commit hook was scaffolded", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-init-hooks-skip-"));
  execFileSync("git", ["init"], { cwd: fixture, stdio: "ignore" });

  const result = initProject(fixture, { hooksPath: true, gates: false, precommit: false });

  assert.equal(result.hooksPathRequested, true);
  assert.equal(result.hooksConfigured, false);
  assert.ok(result.nextSteps.some((step) => step.includes("core.hooksPath was not set")));
});
