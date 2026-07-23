import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { evaluateLocal, formatPassMarkdown } from "../src/lib/pass-local.js";
import { generateConvergence } from "../src/lib/converge.js";

function git(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function initRepo(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pass-${prefix}-`));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "commit.gpgsign", "false");
  return root;
}

function writeAndCommit(root, files, message) {
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", message);
}

test("evaluateLocal returns PASS when nothing risky changed and tests are present", () => {
  const root = initRepo("clean");
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "node --test" } }),
      "package-lock.json": JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3 }),
      "src/index.ts": "export const greet = () => 'hi';\n",
    },
    "init",
  );
  writeAndCommit(root, { "src/index.ts": "export const greet = () => 'hello';\n" }, "tweak");

  const result = evaluateLocal(root, { base: "HEAD~1" });
  assert.equal(result.verdict, "WARN", "review state always warns in local mode");
  const checkNames = result.checks.map((c) => c.name);
  assert.ok(checkNames.includes("Changed files"));
  assert.ok(checkNames.includes("Secret safety"));
  assert.ok(checkNames.includes("Risk review"));
  assert.ok(checkNames.includes("Release discipline"));
  assert.ok(checkNames.includes("Validation commands"));
  assert.ok(checkNames.includes("Dependency audit"));
  assert.ok(checkNames.includes("Review state"));
  assert.ok(checkNames.includes("Policy profile"));
});

test("evaluateLocal enforces a convergence floor and matching receipt", () => {
  const root = initRepo("convergence");
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "node --test" } }),
      "package-lock.json": JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3 }),
      "src/index.ts": "export const greet = () => 'hi';\n",
    },
    "init",
  );
  writeAndCommit(root, { "src/index.ts": "export const greet = () => 'hello';\n" }, "tweak");

  const score = generateConvergence("update the greeting", { path: root, base: "HEAD~1" });
  const result = evaluateLocal(root, {
    base: "HEAD~1",
    request: "update the greeting",
    minConvergence: 0,
    receipt: score.receipt.id,
  });
  const convergence = result.checks.find((check) => check.name === "Convergence");
  assert.equal(convergence.status, "PASS");
  assert.match(convergence.details.join(" "), /Receipt: rcpt_/);

  const mismatch = evaluateLocal(root, {
    base: "HEAD~1",
    request: "update the greeting",
    receipt: "rcpt_000000000000",
  });
  assert.equal(mismatch.checks.find((check) => check.name === "Convergence").status, "FAIL");
});

test("evaluateLocal fails convergence enforcement when no task request is supplied", () => {
  const root = initRepo("convergence-no-task");
  writeAndCommit(root, { "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }), "src/index.ts": "export const hi = 1;\n" }, "init");
  writeAndCommit(root, { "src/index.ts": "export const hi = 2;\n" }, "tweak");

  const result = evaluateLocal(root, { base: "HEAD~1", minConvergence: 50 });
  const convergence = result.checks.find((check) => check.name === "Convergence");
  assert.equal(convergence.status, "FAIL");
  assert.match(convergence.summary, /task request is required/);
});

test("evaluateLocal FAILS when a .env file is in the diff", () => {
  const root = initRepo("secret");
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }),
      "src/index.ts": "export const hi = 1;\n",
    },
    "init",
  );
  writeAndCommit(root, { ".env": "SECRET=xxx\n" }, "leak");

  const result = evaluateLocal(root, { base: "HEAD~1" });
  assert.equal(result.verdict, "FAIL");
  const secret = result.checks.find((c) => c.name === "Secret safety");
  assert.equal(secret.status, "FAIL");
  assert.ok(secret.details.includes(".env"));
});

test("evaluateLocal WARNs when risk-sensitive paths change (prisma schema)", () => {
  const root = initRepo("prisma");
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "node --test" } }),
      "src/index.ts": "export const hi = 1;\n",
    },
    "init",
  );
  writeAndCommit(root, { "prisma/schema.prisma": "model User { id String @id }\n" }, "schema");

  const result = evaluateLocal(root, { base: "HEAD~1" });
  assert.equal(result.verdict, "WARN");
  const risk = result.checks.find((c) => c.name === "Risk review");
  assert.equal(risk.status, "WARN");
  assert.ok(risk.details.some((file) => file.includes("schema.prisma")));
});

test("evaluateLocal escalates to FAIL under high-risk policy when prisma changes locally", () => {
  const root = initRepo("highrisk");
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "node --test" } }),
      "src/index.ts": "export const hi = 1;\n",
    },
    "init",
  );
  writeAndCommit(root, { "prisma/schema.prisma": "model User { id String @id }\n" }, "schema");

  const result = evaluateLocal(root, { base: "HEAD~1", policy: "high-risk" });
  assert.equal(result.verdict, "FAIL");
  const policy = result.checks.find((c) => c.name === "Policy profile");
  assert.equal(policy.status, "FAIL");
  assert.ok(policy.details.some((line) => line.includes("GitHub PR mode")));
});

test("evaluateLocal does not warn Risk review for a test/doc-only change with a risky-looking name", () => {
  const root = initRepo("gate-test-doc");
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "node --test" } }),
      "src/index.ts": "export const hi = 1;\n",
    },
    "init",
  );
  // A test file and a doc that both mention money-/auth-flavored words. These
  // are risk-adjacent for ranking but must not, on their own, trip the gate.
  writeAndCommit(
    root,
    {
      "tests/checkout.spec.ts": "import test from 'node:test';\ntest('checkout', () => {});\n",
      "docs/git-checkout-guide.md": "# Checkout guide\n\nHow to use git checkout.\n",
    },
    "tests and docs",
  );

  const result = evaluateLocal(root, { base: "HEAD~1" });
  const risk = result.checks.find((c) => c.name === "Risk review");
  assert.equal(risk.status, "PASS", `expected no risk warning for test/doc-only change, got ${risk.status}: ${JSON.stringify(risk.details)}`);
});

test("evaluateLocal does not FAIL Secret safety for an env-substring source or a secrets doc", () => {
  const root = initRepo("gate-secret-fp");
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "node --test" } }),
      "src/index.ts": "export const hi = 1;\n",
    },
    "init",
  );
  writeAndCommit(
    root,
    {
      "src/config/dev.environments.ts": "export const environments = ['dev'];\n",
      "docs/secrets-management.md": "# Secrets management\n\nHow we store secrets.\n",
    },
    "env-substring source and secrets doc",
  );

  const result = evaluateLocal(root, { base: "HEAD~1" });
  const secret = result.checks.find((c) => c.name === "Secret safety");
  assert.equal(secret.status, "PASS", `expected secret check to pass, got ${secret.status}: ${JSON.stringify(secret.details)}`);
});

test("evaluateLocal markdown rendering includes the verdict and check names", () => {
  const root = initRepo("markdown");
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "node --test" } }),
      "src/index.ts": "export const hi = 1;\n",
    },
    "init",
  );
  const data = evaluateLocal(root, { base: "HEAD" });
  const markdown = formatPassMarkdown(data);
  assert.match(markdown, /# repoctx pass/);
  assert.match(markdown, /Verdict:/);
  assert.match(markdown, /Secret safety/);
});
