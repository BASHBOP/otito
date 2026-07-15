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
  git(root, ["config", "user.name", "Repoctx Test"]);
  git(root, ["config", "user.email", "repoctx@example.test"]);
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
