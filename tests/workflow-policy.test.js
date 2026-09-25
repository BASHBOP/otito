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

test("the attestation target is passed in a variable the workflow can actually set", () => {
  const workflow = read(".github/workflows/post-merge-attest.yml");
  // GitHub ignores a step's attempt to set a GITHUB_* variable.
  assert.doesNotMatch(workflow, /^\s+GITHUB_SHA:/m);
  assert.match(workflow, /OTITO_TARGET_SHA: \$\{\{ steps\.resolve\.outputs\.target_sha \}\}/);
});

test("the repository is solo-maintained, so its gate and attestation default to solo governance", () => {
  // A solo maintainer has no second reviewer: under team governance every merge
  // records a FAIL for a missing approval nobody can give. An explicit
  // --governance flag still overrides this default.
  assert.equal(JSON.parse(read(".otitorc.json")).governance, "solo");
});

test("only a manual run can reset the audit ledger, and the archived chain is kept", () => {
  const workflow = read(".github/workflows/post-merge-attest.yml");
  assert.match(workflow, /reset_ledger:[\s\S]*?type: boolean\s+default: false/);
  // One place sets the reset, and it is gated on a person dispatching the run.
  assert.equal((workflow.match(/OTITO_ATTEST_RESET_LEDGER/g) ?? []).length, 1);
  assert.match(workflow, /OTITO_ATTEST_RESET_LEDGER: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.reset_ledger && '1' \|\| '0' \}\}/);
  // The superseded chain reaches the audit-ledger branch and the uploaded evidence.
  assert.match(workflow, /for archive in audit-pilot\/ledger-orphaned-\*\.jsonl; do/);
  assert.match(workflow, /path: \|[\s\S]*audit-pilot\/ledger-orphaned-\*\.jsonl/);
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

test("release publishing uses GitHub OIDC without a stored npm token", () => {
  const workflow = read(".github/workflows/release.yml");
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /- name: Publish\n\s+run: npm publish/);
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN/);
});

test("MCP Registry identity matches Bashbop's granted OIDC namespace", () => {
  const manifest = JSON.parse(read("package.json"));
  const server = JSON.parse(read("server.json"));
  assert.equal(manifest.mcpName, "io.github.BASHBOP/otito");
  assert.equal(server.name, manifest.mcpName);
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
      OTITO_TARGET_SHA: "",
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
      OTITO_TARGET_SHA: "",
      OTITO_ATTEST_DRY_RUN: "1",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /first-parent coverage gap/);
});
