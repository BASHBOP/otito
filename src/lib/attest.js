// Post-merge attestation: turn a review verdict into a hash-chained record
// bound to a merged commit, and verify a ledger of such records.
//
// Each record's `recordHash = sha256(prevHash + canonical(body))`, so editing
// any stored field breaks every hash after it, and each record is keyed to an
// exact merge SHA, so a missing commit is visible. The ledger is JSON Lines:
// one record per line, append-only. Locally that file is the whole audit
// trail; a hosted store receives copies of the same records, never the diff
// or the source. See docs/19-local-core-optional-hosted.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Version of the ledger record shape. Bump when a field is added, removed or
 * changes meaning, so a store or a verifier can read old records correctly.
 * Records written before this field existed carry no version and verify as
 * they always did: the hash covers whatever body was stored.
 */
export const ATTESTATION_SCHEMA_VERSION = 1;

/** The hash a chain starts from. */
export const GENESIS_HASH = "0".repeat(64);

/** Where a repository keeps its ledger unless told otherwise. */
export const DEFAULT_LEDGER = "audit-pilot/ledger.jsonl";

/**
 * Stable stringify so the hash is reproducible regardless of key order.
 * @param {unknown} value
 * @returns {string}
 */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value);
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** @param {string} text */
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * @typedef {object} AttestationRecord
 * @property {number} seq
 * @property {string} mergeSha
 * @property {string} prevHash
 * @property {string} recordHash
 * @property {string} [verdict]
 * @property {number} [schemaVersion]
 */

/**
 * Resolve the ledger path: an explicit file, else the default under the repo.
 * @param {{ ledger?: string, path?: string }} [options]
 * @returns {string}
 */
export function resolveLedgerPath(options = {}) {
  if (options.ledger) return resolve(options.ledger);
  return resolve(options.path ?? ".", DEFAULT_LEDGER);
}

/**
 * @param {string} ledgerPath
 * @returns {AttestationRecord[]}
 */
export function readLedger(ledgerPath) {
  if (!existsSync(ledgerPath)) return [];
  return readFileSync(ledgerPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => /** @type {AttestationRecord} */ (JSON.parse(line)));
}

/**
 * @typedef {object} AttestOptions
 * @property {Record<string, any>} verdict the `otito review --json` payload
 * @property {string} merge the merged commit SHA
 * @property {string} [prev] the base (first parent) SHA
 * @property {number|string|null} [pr]
 * @property {string} [author]
 * @property {string|null} [committed] ISO commit time
 */

/**
 * Build the next record for a ledger without writing it.
 * @param {AttestOptions} options
 * @param {AttestationRecord[]} rows the existing ledger, oldest first
 * @returns {AttestationRecord & Record<string, unknown>}
 */
export function buildAttestation(options, rows) {
  const { verdict } = options;
  if (!verdict || typeof verdict !== "object") throw new Error("attest needs a review verdict (JSON from `otito review --json`)");
  if (!options.merge) throw new Error("attest needs --merge <sha>, the merged commit to bind the record to");
  const prevHash = rows.length ? rows[rows.length - 1].recordHash : GENESIS_HASH;
  const pr = Number(options.pr ?? 0) || null;

  const body = {
    schemaVersion: ATTESTATION_SCHEMA_VERSION,
    seq: rows.length + 1,
    mergeSha: options.merge,
    baseSha: options.prev ?? null,
    pr,
    author: options.author ?? "unknown",
    committedAt: options.committed ?? null,
    attestedAt: verdict.generatedAt ?? null,
    engineVersion: verdict.reviewEngineVersion ?? null,
    verdictSchemaVersion: verdict.schemaVersion ?? null,
    policy: verdict.pass?.policy ?? null,
    governance: verdict.pass?.governance ?? null,
    verdict: verdict.verdict,
    confidence: verdict.confidence ?? null,
    changedFiles: verdict.prReviewSummary?.changedFiles ?? null,
    riskLevel: verdict.prReviewSummary?.riskLevel ?? null,
    riskFlags: verdict.prReviewSummary?.riskFlags ?? [],
    checks: (verdict.pass?.checks ?? []).map((/** @type {any} */ check) => ({ name: check.name, status: check.status })),
    impactedFiles: (verdict.impactSummary?.topFiles ?? []).map((/** @type {any} */ file) => file.path),
    prevHash,
  };
  const recordHash = sha256(prevHash + canonical(body));
  return { ...body, recordHash };
}

/**
 * Append one attestation to the ledger and return the record written.
 * @param {AttestOptions & { ledgerPath: string }} options
 * @returns {AttestationRecord & Record<string, unknown>}
 */
export function appendAttestation(options) {
  const rows = readLedger(options.ledgerPath);
  const record = buildAttestation(options, rows);
  mkdirSync(dirname(options.ledgerPath), { recursive: true });
  appendFileSync(options.ledgerPath, `${JSON.stringify(record)}\n`);
  return record;
}

/**
 * @typedef {object} VerifyResult
 * @property {boolean} ok
 * @property {string} ledger
 * @property {number} records
 * @property {string} tip the last record hash, or the genesis hash for an empty ledger
 * @property {Array<{ seq: number, mergeSha: string, verdict: string|null, valid: boolean }>} chain
 */

/**
 * Recompute every hash in the ledger and report the first break.
 * @param {string} ledgerPath
 * @returns {VerifyResult}
 */
export function verifyLedger(ledgerPath) {
  const rows = readLedger(ledgerPath);
  let prev = GENESIS_HASH;
  let ok = true;
  const chain = rows.map((row) => {
    const { recordHash, ...body } = row;
    const valid = sha256(prev + canonical(body)) === recordHash && body.prevHash === prev;
    if (!valid) ok = false;
    prev = recordHash;
    return { seq: body.seq, mergeSha: body.mergeSha, verdict: body.verdict ?? null, valid };
  });
  return { ok, ledger: ledgerPath, records: rows.length, tip: prev, chain };
}

/**
 * @param {VerifyResult} result
 * @returns {string}
 */
export function formatVerify(result) {
  const lines = result.chain.map((row) => `#${row.seq} ${String(row.mergeSha ?? "").slice(0, 7)}  ${row.valid ? "OK  " : "TAMPERED"}  ${row.verdict ?? ""}`);
  lines.push("");
  lines.push(result.ok ? `Chain intact: ${result.records} record(s), tip ${result.tip.slice(0, 12)}` : "CHAIN BROKEN");
  return lines.join("\n");
}

/**
 * @param {AttestationRecord & Record<string, unknown>} record
 * @returns {string}
 */
export function formatAttested(record) {
  return `Attested #${record.seq} ${record.mergeSha.slice(0, 7)} -> ${record.verdict} (conf ${record.confidence})  hash ${record.recordHash.slice(0, 12)}`;
}
