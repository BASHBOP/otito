import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const attest = path.join(repoRoot, "audit-pilot", "attest.mjs");

function runAttest(args, options = {}) {
  return spawnSync(process.execPath, [attest, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test("attest --verify passes on the committed pilot ledger", () => {
  const result = runAttest(["--verify"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Chain intact/);
});

test("attest --verify fails when a ledger record is tampered", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "attest-tamper-"));
  const pilotDir = path.join(tempDir, "audit-pilot");
  fs.mkdirSync(pilotDir, { recursive: true });
  fs.copyFileSync(attest, path.join(pilotDir, "attest.mjs"));

  const ledger = path.join(pilotDir, "ledger.jsonl");
  const sourceLedger = path.join(repoRoot, "audit-pilot", "ledger.jsonl");
  fs.copyFileSync(sourceLedger, ledger);

  const lines = fs.readFileSync(ledger, "utf8").trim().split("\n");
  const row = JSON.parse(lines[0]);
  row.verdict = "FAIL";
  lines[0] = JSON.stringify(row);
  fs.writeFileSync(ledger, `${lines.join("\n")}\n`);

  const result = spawnSync(process.execPath, [path.join(pilotDir, "attest.mjs"), "--verify"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /TAMPERED|CHAIN BROKEN/);
});

test("post-merge attestation records a valid FAIL verdict even when review exits nonzero", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "post-merge-attest-fail-"));
  const scriptsDir = path.join(root, "scripts");
  const pilotDir = path.join(root, "audit-pilot");
  const srcDir = path.join(root, "src");
  const binDir = path.join(root, "bin");
  for (const dir of [scriptsDir, pilotDir, srcDir, binDir]) fs.mkdirSync(dir, { recursive: true });

  fs.copyFileSync(path.join(repoRoot, "scripts", "post-merge-attest.sh"), path.join(scriptsDir, "post-merge-attest.sh"));
  fs.copyFileSync(attest, path.join(pilotDir, "attest.mjs"));
  fs.writeFileSync(
    path.join(srcDir, "cli.js"),
    [
      "console.log(JSON.stringify({",
      "  ok: true, generatedAt: '2026-07-15T00:00:00.000Z', reviewEngineVersion: 1,",
      "  verdict: 'FAIL', confidence: 42,",
      "  pass: { policy: 'standard', governance: 'team', checks: [] },",
      "  prReviewSummary: { changedFiles: 1, riskLevel: 'low', riskFlags: [] },",
      "  impactSummary: { topFiles: [] }",
      "}));",
      "process.exit(1);",
      "",
    ].join("\n"),
  );
  const fakeGh = path.join(binDir, "gh");
  fs.writeFileSync(fakeGh, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(fakeGh, 0o755);

  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Òtítọ́ Test"]);
  git(root, ["config", "user.email", "otito@example.test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "base"]);
  const base = git(root, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(root, "change.txt"), "change\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "fix: guarded merge (#12)"]);
  const merge = git(root, ["rev-parse", "HEAD"]);

  const result = spawnSync("bash", [path.join(scriptsDir, "post-merge-attest.sh")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      GITHUB_SHA: merge,
      GITHUB_EVENT_BEFORE: base,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /blocking verdict/);
  const row = JSON.parse(fs.readFileSync(path.join(pilotDir, "ledger.jsonl"), "utf8"));
  assert.equal(row.verdict, "FAIL");
  assert.equal(row.mergeSha, merge);
});

/**
 * A repository whose ledger chains against commits that are not in it.
 * That is what a rename or a history rewrite leaves behind, and it is the
 * state otito's own `audit-ledger` branch was in: 97 records keyed to
 * repoctx merge SHAs, none reachable from otito's `main`.
 */
function orphanedLedgerRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reconcile-orphan-"));
  const scriptsDir = path.join(root, "scripts");
  const pilotDir = path.join(root, "audit-pilot");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(pilotDir, { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "scripts", "reconcile-attestations.sh"), path.join(scriptsDir, "reconcile-attestations.sh"));

  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Òtítọ́ Test"]);
  git(root, ["config", "user.email", "otito@example.test"]);
  fs.writeFileSync(path.join(root, "a.txt"), "a\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "first commit"]);
  fs.writeFileSync(path.join(root, "b.txt"), "b\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "second (#2)"]);
  const target = git(root, ["rev-parse", "HEAD"]);

  // Two records pointing at commits that exist nowhere in this repository.
  const absent = ["2acaa1229ca4d5842b94f572be438d67863c8156", "7890b54afa1bdd1a31e3273a9d8d377825b0c49a"];
  fs.writeFileSync(path.join(pilotDir, "ledger.jsonl"), absent.map((mergeSha, i) => JSON.stringify({ seq: i + 1, mergeSha })).join("\n") + "\n");

  return { root, target };
}

/**
 * Control the variables the script reads rather than inheriting them.
 *
 * `reconcile-attestations.sh` takes its target from `GITHUB_SHA`, which is set
 * on every GitHub runner. Inheriting the ambient environment pointed the
 * script at the *workflow's* commit, which does not exist inside the temp
 * repository, so `git rev-parse --verify` failed under `set -e` and the test
 * saw exit 128 — the very code it exists to prove is gone. It passed on a
 * machine where `GITHUB_SHA` is unset and failed in CI, which is the same
 * shape as the `TYPESAFE_API_KEY` test recorded in the 1.13.1 changelog.
 */
function runReconcile(root, target, env = {}) {
  return spawnSync("bash", [path.join(root, "scripts", "reconcile-attestations.sh")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_SHA: target,
      GITHUB_EVENT_BEFORE: "",
      OTITO_ATTEST_RESET_LEDGER: "0",
      OTITO_ATTEST_DRY_RUN: "1",
      ...env,
    },
  });
}

test("an orphaned ledger is diagnosed, not reported as git's invalid revision range", () => {
  // Regression: the coverage-gap check ran `git rev-list FIRST..LAST` before
  // anything established those commits were present, so a ledger bound to a
  // dead history died with "fatal: Invalid revision range" and exit 128 —
  // which reads as a broken script rather than a ledger that needs a decision.
  const { root, target } = orphanedLedgerRepo();
  const result = runReconcile(root, target);

  assert.equal(result.status, 1, "must fail deliberately, not with git's 128");
  assert.notEqual(result.status, 128);
  assert.doesNotMatch(result.stderr, /Invalid revision range/);
  assert.match(result.stderr, /not in this repository|not an ancestor/);
  assert.match(result.stderr, /OTITO_ATTEST_RESET_LEDGER=1/, "must name the recovery");
});

test("resetting an orphaned ledger archives the old chain and starts at the tip", () => {
  const { root, target } = orphanedLedgerRepo();
  const result = runReconcile(root, target, { OTITO_ATTEST_RESET_LEDGER: "1" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /archived superseded chain/);

  // The superseded chain is preserved beside the new one, never deleted.
  const archives = fs.readdirSync(path.join(root, "audit-pilot")).filter((f) => f.startsWith("ledger-orphaned-"));
  assert.equal(archives.length, 1, "the old chain must survive the reset");
  assert.equal(
    fs
      .readFileSync(path.join(root, "audit-pilot", archives[0]), "utf8")
      .trim()
      .split("\n").length,
    2,
  );

  // And the new chain starts AT the tip rather than backfilling every
  // ancestor, which would mint verdicts for commits this gate never ran on.
  const attested = result.stdout
    .trim()
    .split("\n")
    .filter((l) => /^[0-9a-f]{40}$/.test(l));
  assert.deepEqual(attested, [target]);
});

test("a ledger that matches the history still reconciles normally", () => {
  const { root, target } = orphanedLedgerRepo();
  // Replace the dead records with the repository's own first commit.
  const first = git(root, ["rev-list", "--max-parents=0", "HEAD"]);
  fs.writeFileSync(path.join(root, "audit-pilot", "ledger.jsonl"), JSON.stringify({ seq: 1, mergeSha: first }) + "\n");

  const result = runReconcile(root, target);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /archived superseded chain/);
  assert.equal(fs.readdirSync(path.join(root, "audit-pilot")).filter((f) => f.startsWith("ledger-orphaned-")).length, 0);
});
