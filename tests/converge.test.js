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
  assert.equal(a.id, "rcpt_d5d0ce15cc98", "legacy receipt display IDs must remain stable");
  assert.equal(a.inputsHash, "d5d0ce15cc986ca6c0a548f8ddd0307e74b76f7af78bdda72ccb4891be7fdfc8");
  assert.equal(a.receiptVersion, undefined);
  assert.equal(a.subject, undefined);
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

test("v2 receipt canonicalises the exact change subject", () => {
  const subject = {
    kind: "github-pr",
    repository: "org/repo",
    number: 42,
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
  };
  const reordered = {
    headSha: subject.headSha.toUpperCase(),
    number: subject.number,
    baseSha: subject.baseSha.toUpperCase(),
    repository: "Org/Repo",
    kind: subject.kind,
  };
  const a = makeReceipt({ ...baseReceiptInput, commit: subject.headSha, subject });
  const b = makeReceipt({ ...baseReceiptInput, commit: subject.headSha.toUpperCase(), subject: reordered });

  assert.equal(a.inputsHash, b.inputsHash);
  assert.equal(a.receiptVersion, 2);
  assert.deepEqual(a.subject, subject);
});

test("v2 receipt changes when only an exact subject identifier changes", () => {
  const staged = {
    kind: "git-index",
    baseSha: "a".repeat(40),
    parentSha: "b".repeat(40),
    treeSha: "c".repeat(40),
  };
  const pr = {
    kind: "github-pr",
    repository: "org/repo",
    number: 42,
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
  };
  const stagedReceipt = makeReceipt({ ...baseReceiptInput, commit: staged.parentSha, subject: staged });
  const changedTree = makeReceipt({ ...baseReceiptInput, commit: staged.parentSha, subject: { ...staged, treeSha: "d".repeat(40) } });
  assert.notEqual(stagedReceipt.inputsHash, changedTree.inputsHash);

  const prReceipt = makeReceipt({ ...baseReceiptInput, commit: pr.headSha, subject: pr });
  const changedBase = makeReceipt({ ...baseReceiptInput, commit: pr.headSha, subject: { ...pr, baseSha: "d".repeat(40) } });
  const changedHead = makeReceipt({ ...baseReceiptInput, commit: "d".repeat(40), subject: { ...pr, headSha: "d".repeat(40) } });
  assert.notEqual(prReceipt.inputsHash, changedBase.inputsHash);
  assert.notEqual(prReceipt.inputsHash, changedHead.inputsHash);
});

test("v2 receipt refuses incomplete or invented subjects", () => {
  assert.throws(
    () => makeReceipt({ ...baseReceiptInput, subject: { kind: "github-pr", baseSha: "a".repeat(40), headSha: "b".repeat(40) } }),
    /invalid exact change subject/,
  );
  assert.throws(
    () => makeReceipt({ ...baseReceiptInput, subject: { kind: "custom", baseSha: "a".repeat(40), headSha: "b".repeat(40) } }),
    /invalid exact change subject/,
  );
  assert.throws(
    () =>
      makeReceipt({
        ...baseReceiptInput,
        commit: "c".repeat(40),
        subject: {
          kind: "github-pr",
          repository: "org/repo",
          number: 42,
          baseSha: "a".repeat(40),
          headSha: "b".repeat(40),
        },
      }),
    /commit does not match/,
  );
});

test("band thresholds: aligned >= 80, partial >= 50, else drift", () => {
  assert.equal(bandFor(100), "aligned");
  assert.equal(bandFor(80), "aligned");
  assert.equal(bandFor(79), "partial");
  assert.equal(bandFor(50), "partial");
  assert.equal(bandFor(49), "drift");
  assert.equal(bandFor(0), "drift");
});
