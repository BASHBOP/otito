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
