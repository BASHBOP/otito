import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = path.join(repoRoot, ".github", "workflows");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function createLinearRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otito-attest-reconcile-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "audit-pilot"), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "scripts", "reconcile-attestations.sh"), path.join(root, "scripts", "reconcile-attestations.sh"));

  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Òtítọ́ Test"]);
  git(root, ["config", "user.email", "otito@example.test"]);

  const commits = [];
  for (const name of ["one", "two", "three"]) {
    fs.writeFileSync(path.join(root, `${name}.txt`), `${name}\n`);
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", name]);
    commits.push(git(root, ["rev-parse", "HEAD"]));
  }
  return { root, commits };
}

test("CI validates PRs once and reserves push validation for main", () => {
  const workflow = read(".github/workflows/otito-ci.yml");
  assert.match(workflow, /pull_request:\n\s+types:/);
  assert.match(workflow, /push:\n\s+branches: \[main\]/);
  assert.doesNotMatch(workflow, /attest-main:/);
});

test("post-merge workflow reconciles successful CI into a durable audit branch", () => {
  const workflow = read(".github/workflows/post-merge-attest.yml");
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \["otito CI"\]/);
  assert.match(workflow, /bash scripts\/reconcile-attestations\.sh/);
  assert.match(workflow, /HEAD:refs\/heads\/audit-ledger/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
});

test("workflow dependencies use setup-node v7 and TypeScript majors require migration", () => {
  const workflowFiles = fs.readdirSync(workflowsDir).filter((name) => name.endsWith(".yml"));
  const workflows = workflowFiles.map((name) => fs.readFileSync(path.join(workflowsDir, name), "utf8")).join("\n");
  assert.doesNotMatch(workflows, /actions\/setup-node@v6/);
  assert.match(workflows, /actions\/setup-node@v7/);

  const dependabot = read(".github/dependabot.yml");
  assert.match(dependabot, /dependency-name: typescript/);
  assert.match(dependabot, /version-update:semver-major/);
});

test("release publishing receives the npm credential fallback", () => {
  const workflow = read(".github/workflows/release.yml");
  assert.match(workflow, /- name: Publish\n\s+run: npm publish\n\s+env:\n\s+NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
});

test("reconciliation dry-run lists missing first-parent commits oldest-first", () => {
  const { root, commits } = createLinearRepo();

  fs.writeFileSync(path.join(root, "audit-pilot", "ledger.jsonl"), `${JSON.stringify({ mergeSha: commits[0] })}\n`);
  const result = spawnSync("bash", [path.join(root, "scripts", "reconcile-attestations.sh")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_SHA: commits[2],
      OTITO_ATTEST_DRY_RUN: "1",
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(result.stdout.trim().split("\n"), [commits[1], commits[2]]);
});

test("reconciliation rejects a cryptographically valid ledger with a first-parent coverage gap", () => {
  const { root, commits } = createLinearRepo();
  fs.writeFileSync(
    path.join(root, "audit-pilot", "ledger.jsonl"),
    `${JSON.stringify({ mergeSha: commits[0] })}\n${JSON.stringify({ mergeSha: commits[2] })}\n`,
  );

  const result = spawnSync("bash", [path.join(root, "scripts", "reconcile-attestations.sh")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_SHA: commits[2],
      OTITO_ATTEST_DRY_RUN: "1",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /first-parent coverage gap/);
});
