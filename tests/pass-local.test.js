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

test("evaluateLocal evaluates only the Git index when staged mode is enabled", () => {
  const root = initRepo("staged");
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "node --test" } }),
      "package-lock.json": JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3 }),
      "src/index.ts": "export const greet = () => 'hi';\n",
      "src/unstaged.ts": "export const unstaged = false;\n",
    },
    "init",
  );
  fs.writeFileSync(path.join(root, "src/index.ts"), "export const greet = () => 'hello';\n");
  git(root, "add", "src/index.ts");
  fs.writeFileSync(path.join(root, "src/unstaged.ts"), "export const unstaged = true;\n");
  fs.writeFileSync(path.join(root, ".env"), "SECRET=not-staged\n");

  const result = evaluateLocal(root, { base: "HEAD", staged: true });
  assert.equal(result.scope, "staged");
  assert.deepEqual(result.changedFiles, ["src/index.ts"]);
  assert.equal(result.verdict, "PASS");
  assert.equal(result.checks.find((check) => check.name === "Review state").status, "PASS");
  assert.equal(result.checks.find((check) => check.name === "Secret safety").status, "PASS");
});

test("evaluateLocal includes configured tieline contract evidence", () => {
  const root = initRepo("tieline");
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "node --test" } }),
      "package-lock.json": JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3 }),
      "src/index.ts": "export const hi = 1;\n",
    },
    "init",
  );
  fs.writeFileSync(path.join(root, "tieline.config.json"), JSON.stringify({ frontend: ".", backend: "." }));
  const bin = path.join(root, "fake-tieline");
  fs.writeFileSync(bin, `#!/usr/bin/env node\nconsole.log(JSON.stringify({ totals: { drift: 0 }, drift: [] }));\n`);
  fs.chmodSync(bin, 0o755);
  const previous = process.env.REPOCTX_TIELINE_BIN;
  process.env.REPOCTX_TIELINE_BIN = bin;
  try {
    const result = evaluateLocal(root, { base: "HEAD" });
    const contracts = result.checks.find((check) => check.name === "Contract drift");
    assert.equal(contracts.status, "PASS");
    assert.match(contracts.summary, /No frontend↔backend contract drift/);
  } finally {
    if (previous === undefined) delete process.env.REPOCTX_TIELINE_BIN;
    else process.env.REPOCTX_TIELINE_BIN = previous;
  }
});

test("evaluateLocal includes configured bouncer compliance evidence", () => {
  const root = initRepo("bouncer");
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "node --test" } }),
      "package-lock.json": JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3 }),
      "src/index.ts": "export const hi = 1;\n",
    },
    "init",
  );
  fs.writeFileSync(path.join(root, "bouncer.config.json"), JSON.stringify({ target: { adapter: "next", repo: "." }, packs: ["uk-osa"] }));
  const bin = path.join(root, "fake-bouncer");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node\nconsole.log(JSON.stringify({ totals: { pass: 2, fail: 1, unknown: 0 }, findings: [{ ruleId: 'osa.report', status: 'fail', fix: 'Add report controls.' }] }));\n`,
  );
  fs.chmodSync(bin, 0o755);
  const previous = process.env.REPOCTX_BOUNCER_BIN;
  process.env.REPOCTX_BOUNCER_BIN = bin;
  try {
    const result = evaluateLocal(root, { base: "HEAD" });
    const compliance = result.checks.find((check) => check.name === "Compliance controls");
    assert.equal(compliance.status, "FAIL");
    assert.match(compliance.summary, /1 required control is missing/);
  } finally {
    if (previous === undefined) delete process.env.REPOCTX_BOUNCER_BIN;
    else process.env.REPOCTX_BOUNCER_BIN = previous;
  }
});

test("evaluateLocal includes opted-in aiglare governance evidence", () => {
  const root = initRepo("aiglare");
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "node --test" } }),
      "package-lock.json": JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3 }),
      "src/index.ts": "export const hi = 1;\n",
    },
    "init",
  );
  const bin = path.join(root, "fake-aiglare");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node\nconsole.log(JSON.stringify({ surfaceCount: 1, surfaces: [{ file: 'src/ai.ts', sink: 'side-effectful', severity: 'red' }], gate: { passed: false, blocking: 1 } }));\n`,
  );
  fs.chmodSync(bin, 0o755);
  const previousBin = process.env.REPOCTX_AIGLARE_BIN;
  const previousOptIn = process.env.REPOCTX_AIGLARE;
  process.env.REPOCTX_AIGLARE_BIN = bin;
  process.env.REPOCTX_AIGLARE = "1";
  try {
    const result = evaluateLocal(root, { base: "HEAD" });
    const governance = result.checks.find((check) => check.name === "AI governance");
    assert.equal(governance.status, "FAIL");
    assert.match(governance.summary, /1 irreversible AI surface lacks/);
  } finally {
    if (previousBin === undefined) delete process.env.REPOCTX_AIGLARE_BIN;
    else process.env.REPOCTX_AIGLARE_BIN = previousBin;
    if (previousOptIn === undefined) delete process.env.REPOCTX_AIGLARE;
    else process.env.REPOCTX_AIGLARE = previousOptIn;
  }
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
