import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { bandFor, generateConvergence, makeReceipt } from "../src/lib/converge.js";

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

// --- drift weighting: a file is not the risk surface its name mentions ---

function convergeGit(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function driftFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otito-converge-drift-"));
  for (const [file, body] of Object.entries({
    "src/index.ts": "export const a = 1;\n",
    "src/payment/checkout.service.ts": "export const c = 1;\n",
    "docs/auth-guide.md": "# auth\n",
    "docs/setup-guide.md": "# setup\n",
    "tests/checkout.spec.ts": "export const t = 1;\n",
    "tests/util.spec.ts": "export const u = 1;\n",
  })) {
    fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), body);
  }
  convergeGit(root, "init", "-q", "-b", "main");
  convergeGit(root, "config", "commit.gpgsign", "false");
  convergeGit(root, "add", ".");
  convergeGit(root, "commit", "-q", "-m", "base");
  return root;
}

function riskAlignmentAfterDrifting(root, file) {
  fs.appendFileSync(path.join(root, file), "// drift\n");
  convergeGit(root, "add", file);
  try {
    return generateConvergence("update the index module", { path: root, base: "HEAD", staged: true }).subScores.riskAlignment;
  } finally {
    convergeGit(root, "restore", "--staged", file);
    convergeGit(root, "checkout", "--", file);
  }
}

test("drifted docs are weighted by being docs, not by the concept their name mentions", () => {
  const root = driftFixture();
  const auth = riskAlignmentAfterDrifting(root, "docs/auth-guide.md");
  const setup = riskAlignmentAfterDrifting(root, "docs/setup-guide.md");
  assert.equal(auth, setup, `two docs should carry the same drift weight, got auth=${auth} setup=${setup}`);
});

test("drifted specs are weighted by being tests, not by the domain they test", () => {
  const root = driftFixture();
  const checkout = riskAlignmentAfterDrifting(root, "tests/checkout.spec.ts");
  const util = riskAlignmentAfterDrifting(root, "tests/util.spec.ts");
  assert.equal(checkout, util, `two specs should carry the same drift weight, got checkout=${checkout} util=${util}`);
});

test("a genuinely risky drifted path is still penalised more than a doc", () => {
  const root = driftFixture();
  const service = riskAlignmentAfterDrifting(root, "src/payment/checkout.service.ts");
  const doc = riskAlignmentAfterDrifting(root, "docs/auth-guide.md");
  assert.ok(service < doc, `payment service drift should cost more than doc drift, got service=${service} doc=${doc}`);
});
