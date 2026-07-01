#!/usr/bin/env node
// Audit-layer pilot: turn a repoctx review_verdict into an immutable,
// hash-chained attestation bound to a merged commit SHA.
//
// Models the "after-merge, complete, tamper-evident" audit layer:
//   post-merge CI:  repoctx review . --pr <n> --json  |  node attest.mjs --merge <sha> ...
// The ledger here stands in for the append-only row in bashbop-api's `audit` domain.
//
// Usage:
//   node attest.mjs --verdict verdict.json --merge <sha> --prev <sha> \
//        --pr 75 --author "Name" --committed <iso>
//   node attest.mjs --verify        # recompute and validate the whole chain
import { createHash } from "node:crypto";
import { readFileSync, appendFileSync, existsSync, readFileSync as rf } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const LEDGER = join(DIR, "ledger.jsonl");
const GENESIS = "0".repeat(64);

// Stable stringify so the hash is reproducible regardless of key order.
function canonical(obj) {
  if (Array.isArray(obj)) return "[" + obj.map(canonical).join(",") + "]";
  if (obj && typeof obj === "object") {
    return (
      "{" +
      Object.keys(obj)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(obj[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(obj);
}
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function readLedger() {
  if (!existsSync(LEDGER)) return [];
  return rf(LEDGER, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i > -1 ? process.argv[i + 1] : def;
}

if (process.argv.includes("--verify")) {
  const rows = readLedger();
  let prev = GENESIS,
    ok = true;
  for (const row of rows) {
    const { recordHash, ...body } = row;
    const expected = sha256(prev + canonical(body));
    const valid = expected === recordHash && body.prevHash === prev;
    console.log(`#${body.seq} ${body.mergeSha.slice(0, 7)}  ${valid ? "OK  " : "TAMPERED"}  ${body.verdict}`);
    if (!valid) ok = false;
    prev = recordHash;
  }
  console.log(ok ? `\nChain intact: ${rows.length} record(s), tip ${prev.slice(0, 12)}` : "\nCHAIN BROKEN");
  process.exit(ok ? 0 : 1);
}

// --- append mode ---
const verdict = JSON.parse(readFileSync(arg("verdict"), "utf8"));
const rows = readLedger();
const prevHash = rows.length ? rows[rows.length - 1].recordHash : GENESIS;

const body = {
  seq: rows.length + 1,
  mergeSha: arg("merge"),
  baseSha: arg("prev"),
  pr: Number(arg("pr", 0)) || null,
  author: arg("author", "unknown"),
  committedAt: arg("committed", null),
  attestedAt: verdict.generatedAt,
  engineVersion: verdict.reviewEngineVersion,
  policy: verdict.pass?.policy,
  governance: verdict.pass?.governance,
  verdict: verdict.verdict,
  confidence: verdict.confidence,
  changedFiles: verdict.prReviewSummary?.changedFiles,
  riskLevel: verdict.prReviewSummary?.riskLevel,
  riskFlags: verdict.prReviewSummary?.riskFlags ?? [],
  checks: (verdict.pass?.checks ?? []).map((c) => ({ name: c.name, status: c.status })),
  impactedFiles: (verdict.impactSummary?.topFiles ?? []).map((f) => f.path),
  prevHash,
};
const recordHash = sha256(prevHash + canonical(body));
appendFileSync(LEDGER, JSON.stringify({ ...body, recordHash }) + "\n");
console.log(`Attested #${body.seq} ${body.mergeSha.slice(0, 7)} -> ${body.verdict} (conf ${body.confidence})  hash ${recordHash.slice(0, 12)}`);
