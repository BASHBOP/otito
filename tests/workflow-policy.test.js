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
  // The repo's own workflow only resolves which commit merged; the attestation
  // is the reusable workflow, which any repository can call the same way.
  const caller = read(".github/workflows/post-merge-attest.yml");
  assert.match(caller, /workflow_run:/);
  assert.match(caller, /workflows: \["otito CI"\]/);
  assert.match(caller, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(caller, /uses: \.\/\.github\/workflows\/attest\.yml/);
  // otito attests its own commit with the engine that commit ships.
  assert.match(caller, /otito_ref: \$\{\{ needs\.resolve\.outputs\.target_sha \}\}/);

  const reusable = read(".github/workflows/attest.yml");
  assert.match(reusable, /^on:\s+workflow_call:/m);
  assert.match(reusable, /target_sha:[\s\S]*?required: true/);
  assert.match(reusable, /scripts\/reconcile-attestations\.sh/);
  assert.match(reusable, /ledger_branch:[\s\S]*?default: audit-ledger/);
  assert.match(reusable, /HEAD:refs\/heads\/\$LEDGER_BRANCH/);
  // The tool is checked out beside the repository under attestation and kept
  // out of its tree, so the review never sees otito's own files as a change.
  assert.match(reusable, /OTITO_REPO: \$\{\{ github\.workspace \}\}/);
  assert.match(reusable, /OTITO_BIN: node \$\{\{ github\.workspace \}\}\/\$\{\{ env\.OTITO_TOOL_DIR \}\}\/src\/cli\.js/);
  assert.match(reusable, /echo "\$OTITO_TOOL_DIR\/" >> \.git\/info\/exclude/);
});

test("the attestation target is passed in a variable the workflow can actually set", () => {
  const caller = read(".github/workflows/post-merge-attest.yml");
  const reusable = read(".github/workflows/attest.yml");
  // GitHub ignores a step's attempt to set a GITHUB_* variable.
  assert.doesNotMatch(caller, /^\s+GITHUB_SHA:/m);
  assert.doesNotMatch(reusable, /^\s+GITHUB_SHA:/m);
  assert.match(caller, /target_sha: \$\{\{ needs\.resolve\.outputs\.target_sha \}\}/);
  assert.match(reusable, /OTITO_TARGET_SHA: \$\{\{ inputs\.target_sha \}\}/);
});

test("the repository is solo-maintained, so its gate and attestation default to solo governance", () => {
  // A solo maintainer has no second reviewer: under team governance every merge
  // records a FAIL for a missing approval nobody can give. An explicit
  // --governance flag still overrides this default.
  assert.equal(JSON.parse(read(".otitorc.json")).governance, "solo");
});

test("only a manual run can reset the audit ledger, and the archived chain is kept", () => {
  const caller = read(".github/workflows/post-merge-attest.yml");
  const reusable = read(".github/workflows/attest.yml");
  assert.match(caller, /reset_ledger:[\s\S]*?type: boolean\s+default: false/);
  assert.match(reusable, /reset_ledger:[\s\S]*?type: boolean\s+default: false/);
  // The caller decides, once, and only a person dispatching the run can say yes.
  assert.equal((caller.match(/reset_ledger: \$\{\{/g) ?? []).length, 1);
  assert.match(caller, /reset_ledger: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.reset_ledger \|\| false \}\}/);
  // The reusable workflow sets the script variable in one place, from that input.
  assert.equal((reusable.match(/OTITO_ATTEST_RESET_LEDGER/g) ?? []).length, 1);
  assert.match(reusable, /OTITO_ATTEST_RESET_LEDGER: \$\{\{ inputs\.reset_ledger && '1' \|\| '0' \}\}/);
  assert.doesNotMatch(caller, /OTITO_ATTEST_RESET_LEDGER/);
  // The superseded chain reaches the ledger branch and the uploaded evidence.
  assert.match(reusable, /for archive in "\$LEDGER_DIR"\/ledger-orphaned-\*\.jsonl; do/);
  assert.match(reusable, /path: \|[\s\S]*ledger-orphaned-\*\.jsonl/);
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
