import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { evaluatePR } from "../src/lib/pass-pr.js";

function gitInit(prefix, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pass-pr-${prefix}-`));
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

function fakeRunner(map) {
  return {
    run(_cwd, args) {
      const joined = args.join(" ");
      for (const [keyPrefix, response] of Object.entries(map)) {
        if (joined === keyPrefix || joined.startsWith(`${keyPrefix} `)) {
          if (response instanceof Error) throw response;
          return response;
        }
      }
      throw new Error(`fake gh runner: missing response for "${joined}"`);
    },
  };
}

const baselineCanned = {
  "pr view": JSON.stringify({
    number: 42,
    title: "Add Stripe refunds",
    url: "https://github.com/org/repo/pull/42",
    baseRefName: "main",
    isDraft: false,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    reviewDecision: "APPROVED",
    files: [{ path: "src/payment.ts" }],
    reviews: [{ author: { login: "alice" }, state: "APPROVED" }],
    statusCheckRollup: [{ name: "tests", conclusion: "SUCCESS" }],
  }),
  "repo view": JSON.stringify({ nameWithOwner: "org/repo" }),
  "api graphql": JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } }),
  "api repos/org/repo/branches/main/protection": JSON.stringify({
    required_pull_request_reviews: { required_approving_review_count: 1, require_code_owner_reviews: true },
    required_status_checks: { contexts: ["tests"], checks: [{ context: "tests" }] },
    required_conversation_resolution: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  }),
};

test("evaluatePR returns PASS-grade checks when approved with clean CI and protected branch", async () => {
  const root = gitInit("approved", {
    "package.json": JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "node --test" } }),
    "src/utils/format.ts": "export const fmt = 1;\n",
    ".github/CODEOWNERS": "src/utils/format.ts @alice\n",
  });
  const canned = {
    ...baselineCanned,
    "pr view": JSON.stringify({
      ...JSON.parse(baselineCanned["pr view"]),
      files: [{ path: "src/utils/format.ts" }],
    }),
  };
  const data = await evaluatePR(root, "42", { runner: fakeRunner(canned) });
  assert.equal(data.verdict, "PASS");
  assert.equal(data.checks.find((c) => c.name === "Review decision").status, "PASS");
  assert.equal(data.checks.find((c) => c.name === "PR state").status, "PASS");
  assert.equal(data.checks.find((c) => c.name === "Status checks").status, "PASS");
  assert.equal(data.checks.find((c) => c.name === "Branch protection").status, "PASS");
});

test("evaluatePR FAILS when PR is a draft", async () => {
  const root = gitInit("draft", { "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }) });
  const canned = {
    ...baselineCanned,
    "pr view": JSON.stringify({ ...JSON.parse(baselineCanned["pr view"]), isDraft: true }),
  };
  const data = await evaluatePR(root, "42", { runner: fakeRunner(canned) });
  assert.equal(data.verdict, "FAIL");
  assert.equal(data.checks.find((c) => c.name === "PR state").status, "FAIL");
});

test("evaluatePR FAILS on requested changes", async () => {
  const root = gitInit("changes", { "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }) });
  const canned = {
    ...baselineCanned,
    "pr view": JSON.stringify({ ...JSON.parse(baselineCanned["pr view"]), reviewDecision: "CHANGES_REQUESTED" }),
  };
  const data = await evaluatePR(root, "42", { runner: fakeRunner(canned) });
  assert.equal(data.verdict, "FAIL");
  assert.equal(data.checks.find((c) => c.name === "Review decision").status, "FAIL");
});

test("evaluatePR FAILS on a failed status check", async () => {
  const root = gitInit("failing-ci", { "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }) });
  const canned = {
    ...baselineCanned,
    "pr view": JSON.stringify({
      ...JSON.parse(baselineCanned["pr view"]),
      statusCheckRollup: [{ name: "tests", conclusion: "FAILURE", detailsUrl: "" }],
    }),
  };
  const data = await evaluatePR(root, "42", { runner: fakeRunner(canned) });
  assert.equal(data.verdict, "FAIL");
  assert.equal(data.checks.find((c) => c.name === "Status checks").status, "FAIL");
});

test("evaluatePR FAILS on CODEOWNERS approval missing for changed files", async () => {
  const root = gitInit("codeowners", {
    "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }),
    "src/payment.ts": "export const refund = 1;\n",
    ".github/CODEOWNERS": "src/payment.ts @bob\n",
  });
  const canned = {
    ...baselineCanned,
    "pr view": JSON.stringify({
      ...JSON.parse(baselineCanned["pr view"]),
      reviews: [{ author: { login: "alice" }, state: "APPROVED" }],
    }),
  };
  const data = await evaluatePR(root, "42", { runner: fakeRunner(canned) });
  assert.equal(data.checks.find((c) => c.name === "CODEOWNERS").status, "FAIL");
  assert.equal(data.verdict, "FAIL");
});

test("evaluatePR passes CODEOWNERS when the owner has approved", async () => {
  const root = gitInit("codeowners-approved", {
    "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }),
    "src/payment.ts": "export const refund = 1;\n",
    ".github/CODEOWNERS": "src/payment.ts @alice\n",
  });
  const data = await evaluatePR(root, "42", { runner: fakeRunner(baselineCanned) });
  assert.equal(data.checks.find((c) => c.name === "CODEOWNERS").status, "PASS");
  // Risk review WARNs because src/payment.ts is a money-flow path, so the
  // overall verdict is WARN. CODEOWNERS itself must PASS.
  assert.equal(data.verdict, "WARN");
});

test("evaluatePR WARNs when branch protection is missing", async () => {
  const root = gitInit("no-protection", { "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }) });
  const canned = {
    ...baselineCanned,
    "api repos/org/repo/branches/main/protection": new Error("HTTP 404: Branch not protected"),
  };
  const data = await evaluatePR(root, "42", { runner: fakeRunner(canned) });
  const protection = data.checks.find((c) => c.name === "Branch protection");
  assert.equal(protection.status, "WARN");
  assert.match(protection.summary, /not protected/);
});

test("evaluatePR FAILs under high-risk policy when sensitive paths change without CODEOWNERS pass", async () => {
  const root = gitInit("high-risk", {
    "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }),
  });
  const canned = {
    ...baselineCanned,
    "pr view": JSON.stringify({
      ...JSON.parse(baselineCanned["pr view"]),
      files: [{ path: "prisma/schema.prisma" }, { path: "src/payment.ts" }],
    }),
  };
  const data = await evaluatePR(root, "42", { policy: "high-risk", runner: fakeRunner(canned) });
  const policy = data.checks.find((c) => c.name === "Policy profile");
  assert.notEqual(policy.status, "PASS", `expected non-PASS policy under high-risk, got ${policy.status}`);
});
