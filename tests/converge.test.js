import test from "node:test";
import assert from "node:assert/strict";
import { bandFor, makeReceipt } from "../src/lib/converge.js";

// The engine's git/diff scoring path is integration-tested end-to-end in
// tests/mcp-dispatch.test.js ("convergence_score scores intent vs diff against a
// real git fixture"); here we lock the pure, deterministic pieces: the receipt's
// recomputability (the "tamper-evident attestation" claim) and the band thresholds.

const baseReceiptInput = {
  engine: "0.1.0",
  task: "add Stripe refunds",
  base: "origin/main",
  commit: "abc123",
  convergence: 72,
  subScores: { coverage: 80, scope: 70, riskAlignment: 60 },
  changedFiles: ["src/payment/refund.js", "src/payment/checkout.js"],
  confirmedDirect: ["src/payment/refund.js"],
  confirmedRelated: ["src/payment/checkout.js"],
  unconfirmedCandidates: [],
  missedChangedFiles: [],
};

test("receipt is deterministic — same inputs produce the same id and hash", () => {
  const a = makeReceipt(baseReceiptInput);
  const b = makeReceipt({ ...baseReceiptInput });
  assert.equal(a.inputsHash, b.inputsHash);
  assert.equal(a.id, b.id);
  assert.equal(a.algorithm, "sha256");
  assert.match(a.id, /^rcpt_[0-9a-f]{12}$/);
});

test("receipt is order-independent — file list ordering does not change the hash", () => {
  const a = makeReceipt(baseReceiptInput);
  const b = makeReceipt({
    ...baseReceiptInput,
    changedFiles: ["src/payment/checkout.js", "src/payment/refund.js"],
  });
  assert.equal(a.inputsHash, b.inputsHash, "sorting the canonical payload makes the receipt order-independent");
});

test("receipt changes when a load-bearing input changes", () => {
  const base = makeReceipt(baseReceiptInput);
  const score = makeReceipt({ ...baseReceiptInput, convergence: 73 });
  const commit = makeReceipt({ ...baseReceiptInput, commit: "def456" });
  const task = makeReceipt({ ...baseReceiptInput, task: "add Stripe payouts" });
  const drift = makeReceipt({ ...baseReceiptInput, missedChangedFiles: ["src/auth/login.js"] });
  for (const variant of [score, commit, task, drift]) {
    assert.notEqual(base.inputsHash, variant.inputsHash);
  }
});

test("band thresholds: aligned >= 80, partial >= 50, else drift", () => {
  assert.equal(bandFor(100), "aligned");
  assert.equal(bandFor(80), "aligned");
  assert.equal(bandFor(79), "partial");
  assert.equal(bandFor(50), "partial");
  assert.equal(bandFor(49), "drift");
  assert.equal(bandFor(0), "drift");
});
