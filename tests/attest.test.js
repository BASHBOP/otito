import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "src", "cli.js");

function runAttest(args, options = {}) {
  return spawnSync(process.execPath, [cli, "attest", ...args], {
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

  const json = runAttest([".", "--verify", "--json"]);
  assert.equal(json.status, 0, json.stderr || json.stdout);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.records, payload.chain.length);
  assert.ok(payload.chain.every((row) => row.valid));
});

test("attest appends a versioned record that chains on the previous one, and refuses without a merge SHA", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "attest-append-"));
  const ledger = path.join(tempDir, "ledger", "chain.jsonl");
  const verdictPath = path.join(tempDir, "verdict.json");
  fs.writeFileSync(
    verdictPath,
    JSON.stringify({
      ok: true,
      generatedAt: "2026-09-25T00:00:00.000Z",
      schemaVersion: 1,
      reviewEngineVersion: 1,
      verdict: "PASS",
      confidence: 88,
      pass: { policy: "standard", governance: "solo", checks: [{ name: "Secret safety", status: "PASS", detail: "dropped" }] },
      prReviewSummary: { changedFiles: 2, riskLevel: "low", riskFlags: [] },
      impactSummary: { topFiles: [{ path: "src/a.js", score: 9 }] },
    }),
  );

  const missing = runAttest(["--verdict", verdictPath, "--ledger", ledger]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--merge/);
  assert.equal(fs.existsSync(ledger), false, "nothing is written until the record is complete");

  const first = runAttest(["--verdict", verdictPath, "--merge", "a".repeat(40), "--prev", "b".repeat(40), "--pr", "12", "--ledger", ledger, "--json"]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const { record } = JSON.parse(first.stdout);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.verdictSchemaVersion, 1);
  assert.equal(record.seq, 1);
  assert.equal(record.pr, 12);
  assert.equal(record.prevHash, "0".repeat(64));
  assert.deepEqual(record.checks, [{ name: "Secret safety", status: "PASS" }], "checks keep name and status only");
  assert.deepEqual(record.impactedFiles, ["src/a.js"]);

  const second = runAttest(["--verdict", verdictPath, "--merge", "c".repeat(40), "--ledger", ledger, "--json"]);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const next = JSON.parse(second.stdout).record;
  assert.equal(next.seq, 2);
  assert.equal(next.prevHash, record.recordHash, "each record hashes the one before it");
  assert.equal(next.pr, null);

  const verify = runAttest(["--verify", "--ledger", ledger]);
  assert.equal(verify.status, 0, verify.stderr || verify.stdout);
  assert.match(verify.stdout, /Chain intact: 2 record\(s\)/);
});

test("attest --verify fails when a ledger record is tampered", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "attest-tamper-"));
  const pilotDir = path.join(tempDir, "audit-pilot");
  fs.mkdirSync(pilotDir, { recursive: true });

  const ledger = path.join(pilotDir, "ledger.jsonl");
  const sourceLedger = path.join(repoRoot, "audit-pilot", "ledger.jsonl");
  fs.copyFileSync(sourceLedger, ledger);

  const lines = fs.readFileSync(ledger, "utf8").trim().split("\n");
  const row = JSON.parse(lines[0]);
  row.verdict = "FAIL";
  lines[0] = JSON.stringify(row);
  fs.writeFileSync(ledger, `${lines.join("\n")}\n`);

  // The default ledger is <repo>/audit-pilot/ledger.jsonl; --ledger names it outright.
  const result = runAttest([tempDir, "--verify"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /TAMPERED|CHAIN BROKEN/);
  const named = runAttest(["--verify", "--ledger", ledger, "--json"]);
  assert.equal(named.status, 1);
  assert.equal(JSON.parse(named.stdout).ok, false);
});

test("post-merge attestation records a valid FAIL verdict even when review exits nonzero", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "post-merge-attest-fail-"));
  const scriptsDir = path.join(root, "scripts");
  const pilotDir = path.join(root, "audit-pilot");
  const srcDir = path.join(root, "src");
  const binDir = path.join(root, "bin");
  for (const dir of [scriptsDir, pilotDir, srcDir, binDir]) fs.mkdirSync(dir, { recursive: true });

  fs.copyFileSync(path.join(repoRoot, "scripts", "post-merge-attest.sh"), path.join(scriptsDir, "post-merge-attest.sh"));
  // The script calls `src/cli.js` for both the review and the attestation.
  // This stand-in fakes the review (a FAIL that exits nonzero) and hands
  // `attest` to the real CLI so the ledger it writes is the real format.
  fs.writeFileSync(
    path.join(srcDir, "cli.js"),
    [
      "if (process.argv[2] === 'attest') {",
      "  const { spawnSync } = require('node:child_process');",
      `  const run = spawnSync(process.execPath, [${JSON.stringify(cli)}, ...process.argv.slice(2)], { stdio: 'inherit' });`,
      "  process.exit(run.status ?? 1);",
      "}",
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
      OTITO_TARGET_SHA: "",
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
      OTITO_TARGET_SHA: "",
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

test("the target comes from OTITO_TARGET_SHA, because a workflow cannot override the runner's GITHUB_SHA", () => {
  // Regression: the workflow set GITHUB_SHA on the reconcile step, GitHub kept
  // its own value (the default branch head at run time), and a run meant to
  // start the new chain at b3f795d attested the newer fc0a7b9 instead.
  const { root, target } = orphanedLedgerRepo();
  const runnerHead = git(root, ["rev-list", "--max-parents=0", "HEAD"]);
  const result = runReconcile(root, target, { OTITO_ATTEST_RESET_LEDGER: "1", GITHUB_SHA: runnerHead, OTITO_TARGET_SHA: target });

  assert.equal(result.status, 0, result.stderr || result.stdout);
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
