import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { formatReviewTerminal, generateReview } from "../src/lib/review.js";
import { createRenderer } from "../src/lib/render/fancy.js";

function gitInit(prefix, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `review-${prefix}-`));
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  spawnSync("git", ["config", "user.email", "t@t"], { cwd: root });
  spawnSync("git", ["config", "user.name", "T"], { cwd: root });
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  spawnSync("git", ["add", "."], { cwd: root });
  spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: root });
  return root;
}

test("generateReview returns unified verdict + confidence + summaries", async () => {
  const root = gitInit("composite", {
    "package.json": JSON.stringify({ name: "review-fixture", version: "1.0.0", scripts: { test: "node --test" } }),
    "src/payment/processors/stripe.processor.ts": "export class StripeProcessor { refund() {} }\n",
    "src/booking/booking.controller.ts": "export class BookingController {}\n",
  });
  const { data } = await generateReview(root, { request: "add Stripe refunds to bookings", base: "HEAD" });
  assert.equal(data.ok, true);
  assert.ok(["PASS", "WARN", "FAIL"].includes(data.verdict));
  assert.ok(typeof data.confidence === "number" && data.confidence >= 0 && data.confidence <= 100);
  assert.ok(data.impactSummary.concepts.includes("money flow"), `expected money-flow concept, got ${data.impactSummary.concepts.join(", ")}`);
  assert.ok(data.impactSummary.topFiles.some((file) => file.path.includes("stripe.processor.ts")));
  assert.ok(Array.isArray(data.pass.checks) && data.pass.checks.length >= 5);
});

test("generateReview reports the PR comparison statistics instead of zeroes", async () => {
  const root = gitInit("comparison-stats", {
    "package.json": JSON.stringify({ name: "review-fixture", version: "1.0.0", scripts: { test: "node --test" } }),
    "src/index.ts": "export const initial = true;\n",
  });
  fs.writeFileSync(path.join(root, "src/index.ts"), "export const initial = true;\nexport const changed = true;\n");

  const { data } = await generateReview(root, { request: "add the changed export", base: "HEAD" });

  assert.equal(data.prReviewSummary.changedFiles, 1);
  assert.equal(data.prReviewSummary.additions, 1);
  assert.equal(data.prReviewSummary.deletions, 0);
});

test("formatReviewTerminal renders a verdict line with bars in fancy mode", async () => {
  const root = gitInit("fancy", {
    "package.json": JSON.stringify({ name: "review-fixture", version: "1.0.0", scripts: { test: "node --test" } }),
    "src/index.ts": "export const ok = 1;\n",
  });
  const { data } = await generateReview(root, { request: "tweak something", base: "HEAD" });
  const fancy = formatReviewTerminal(data, (opts) => createRenderer({ ...opts, emoji: true }));
  assert.match(fancy, /otito review/);
  assert.match(fancy, /verdict/);
  assert.match(fancy, /confidence/);
});

test("formatReviewTerminal stays legible in plain mode", async () => {
  const root = gitInit("plain", {
    "package.json": JSON.stringify({ name: "review-fixture", version: "1.0.0", scripts: { test: "node --test" } }),
    "src/index.ts": "export const ok = 1;\n",
  });
  const { data } = await generateReview(root, { request: "tweak something", base: "HEAD" });
  const plain = formatReviewTerminal(data, (opts) => createRenderer({ ...opts, emoji: false }));
  assert.ok(!plain.includes("🚦"));
  assert.match(plain, /Confidence/);
  assert.match(plain, /\[#+\.*\]|\[\.*\]/, "expected an ASCII bar somewhere");
});
