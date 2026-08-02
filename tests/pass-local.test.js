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
  assert.match(result.checks.find((check) => check.name === "Staged snapshot").details.join(" "), /not bound by this convergence receipt/);
});

test("run-validation executes the base-committed policy against the exact staged tree", () => {
  const root = initRepo("validation-snapshot");
  writeAndCommit(
    root,
    {
      "otito.gate.json": JSON.stringify({
        version: 1,
        validation: {
          commands: [
            {
              id: "staged-source",
              command: `${process.execPath} -e "const fs=require('node:fs'); process.exit(fs.readFileSync('src/value.js','utf8').includes('staged') ? 0 : 1)"`,
              timeoutSeconds: 10,
            },
          ],
        },
      }),
      "src/value.js": "module.exports = 'base';\n",
    },
    "init",
  );
  fs.writeFileSync(path.join(root, "src/value.js"), "module.exports = 'staged';\n");
  git(root, "add", "src/value.js");
  fs.writeFileSync(path.join(root, "src/value.js"), "module.exports = 'unstaged';\n");

  const result = evaluateLocal(root, { base: "HEAD", staged: true, runValidation: true });
  const execution = result.checks.find((check) => check.name === "Validation execution");

  assert.equal(execution.status, "PASS");
  assert.match(execution.summary, /exact staged tree/);
  assert.equal(result.validationEvidence.policy.version, 1);
  assert.equal(result.validationEvidence.policy.path, "otito.gate.json");
  assert.equal(result.validationEvidence.environment.dependencyStateAttested, false);
  assert.equal(result.validationEvidence.commands[0].status, "PASS");
  assert.equal(result.validationEvidence.receipt.receiptVersion, 1);
  assert.deepEqual(result.validationEvidence.receipt.subject, result.subject);
});

test("run-validation reads its policy from the base commit rather than the staged change", () => {
  const root = initRepo("validation-policy");
  writeAndCommit(
    root,
    {
      "otito.gate.json": JSON.stringify({
        version: 1,
        validation: { commands: [{ id: "base-policy", command: `${process.execPath} -e "process.exit(0)"` }] },
      }),
      "src/value.js": "module.exports = 'base';\n",
    },
    "init",
  );
  fs.writeFileSync(
    path.join(root, "otito.gate.json"),
    JSON.stringify({ version: 1, validation: { commands: [{ id: "staged-policy", command: `${process.execPath} -e "process.exit(1)"` }] } }),
  );
  fs.writeFileSync(path.join(root, "src/value.js"), "module.exports = 'staged';\n");
  git(root, "add", "otito.gate.json", "src/value.js");

  const result = evaluateLocal(root, { base: "HEAD", staged: true, runValidation: true });

  assert.equal(result.checks.find((check) => check.name === "Validation execution").status, "PASS");
  assert.equal(result.validationEvidence.commands[0].id, "base-policy");
});

test("run-validation rejects a staged replacement of a base-pinned npm script", () => {
  const root = initRepo("validation-script-tamper");
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ scripts: { test: `${process.execPath} -e "process.exit(0)"` } }),
      "otito.gate.json": JSON.stringify({ version: 1, validation: { commands: [{ id: "unit", command: "npm test" }] } }),
      "src/value.js": "module.exports = 'base';\n",
    },
    "init",
  );
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: `${process.execPath} -e "process.exit(0)"` } }));
  fs.writeFileSync(path.join(root, "src/value.js"), "module.exports = 'staged';\n");
  // A no-op replacement may look successful to npm, but it is not the script
  // approved by the base-committed validation policy.
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "true" } }));
  git(root, "add", "package.json", "src/value.js");

  const result = evaluateLocal(root, { base: "HEAD", staged: true, runValidation: true });
  const command = result.validationEvidence.commands[0];

  assert.equal(result.checks.find((check) => check.name === "Validation execution").status, "FAIL");
  assert.equal(command.status, "FAIL");
  assert.equal(command.packageScript.scriptName, "test");
  assert.equal(command.exitCode, null);
});

for (const [label, policyCommand, expectedManager] of [
  ["Yarn", "yarn test", "yarn"],
  ["pnpm", "pnpm test", "pnpm"],
  ["Bun", "bun run test", "bun"],
  ["Corepack Yarn", "corepack yarn run test", "yarn"],
]) {
  test(`run-validation rejects a staged replacement of a base-pinned ${label} script`, () => {
    const root = initRepo(`validation-${expectedManager}-script-tamper`);
    writeAndCommit(
      root,
      {
        "package.json": JSON.stringify({ scripts: { test: `${process.execPath} -e "process.exit(0)"` } }),
        "otito.gate.json": JSON.stringify({ version: 1, validation: { commands: [{ id: "unit", command: policyCommand }] } }),
        "src/value.js": "module.exports = 'base';\n",
      },
      "init",
    );
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "true" } }));
    git(root, "add", "package.json");

    const result = evaluateLocal(root, { base: "HEAD", staged: true, runValidation: true });
    const command = result.validationEvidence.commands[0];

    assert.equal(result.checks.find((check) => check.name === "Validation execution").status, "FAIL");
    assert.equal(command.status, "FAIL");
    assert.equal(command.packageScript.packageManager, expectedManager);
    assert.equal(command.packageScript.scriptName, "test");
  });
}

test("run-validation excludes host secrets unless the base policy explicitly allows them", () => {
  const root = initRepo("validation-environment");
  const previous = process.env.OTITO_TEST_HOST_SECRET;
  process.env.OTITO_TEST_HOST_SECRET = "not-for-staged-code";
  writeAndCommit(
    root,
    {
      "otito.gate.json": JSON.stringify({
        version: 1,
        validation: {
          commands: [{ id: "secret-boundary", command: `${process.execPath} -e "process.exit(process.env.OTITO_TEST_HOST_SECRET ? 1 : 0)"` }],
        },
      }),
      "src/value.js": "module.exports = 'base';\n",
    },
    "init",
  );
  fs.writeFileSync(path.join(root, "src/value.js"), "module.exports = 'staged';\n");
  git(root, "add", "src/value.js");

  try {
    const result = evaluateLocal(root, { base: "HEAD", staged: true, runValidation: true });
    assert.equal(result.checks.find((check) => check.name === "Validation execution").status, "PASS");
    assert.deepEqual(result.validationEvidence.environment.inheritedVariables, []);
    assert.equal(result.validationEvidence.environment.isolatedHome, true);
  } finally {
    if (previous === undefined) delete process.env.OTITO_TEST_HOST_SECRET;
    else process.env.OTITO_TEST_HOST_SECRET = previous;
  }
});

test("run-validation supports a base-policy allowlist for required environment variables", () => {
  const root = initRepo("validation-environment-allow");
  const previous = process.env.OTITO_TEST_REQUIRED_VALUE;
  process.env.OTITO_TEST_REQUIRED_VALUE = "available";
  writeAndCommit(
    root,
    {
      "otito.gate.json": JSON.stringify({
        version: 1,
        validation: {
          environment: { allow: ["OTITO_TEST_REQUIRED_VALUE"] },
          commands: [
            { id: "explicit-secret", command: `${process.execPath} -e "process.exit(process.env.OTITO_TEST_REQUIRED_VALUE === 'available' ? 0 : 1)"` },
          ],
        },
      }),
      "src/value.js": "module.exports = 'base';\n",
    },
    "init",
  );
  fs.writeFileSync(path.join(root, "src/value.js"), "module.exports = 'staged';\n");
  git(root, "add", "src/value.js");

  try {
    const result = evaluateLocal(root, { base: "HEAD", staged: true, runValidation: true });
    assert.equal(result.checks.find((check) => check.name === "Validation execution").status, "PASS");
    assert.deepEqual(result.validationEvidence.environment.inheritedVariables, ["OTITO_TEST_REQUIRED_VALUE"]);
  } finally {
    if (previous === undefined) delete process.env.OTITO_TEST_REQUIRED_VALUE;
    else process.env.OTITO_TEST_REQUIRED_VALUE = previous;
  }
});

test("run-validation records failed command evidence without retaining raw output", () => {
  const root = initRepo("validation-failure");
  const previous = process.env.OTITO_TEST_SECRET_OUTPUT;
  process.env.OTITO_TEST_SECRET_OUTPUT = "private failure";
  writeAndCommit(
    root,
    {
      "otito.gate.json": JSON.stringify({
        version: 1,
        validation: { commands: [{ id: "fails", command: `${process.execPath} -e "console.error(process.env.OTITO_TEST_SECRET_OUTPUT); process.exit(2)"` }] },
      }),
      "src/value.js": "module.exports = 'base';\n",
    },
    "init",
  );
  fs.writeFileSync(path.join(root, "src/value.js"), "module.exports = 'staged';\n");
  git(root, "add", "src/value.js");

  try {
    const result = evaluateLocal(root, { base: "HEAD", staged: true, runValidation: true });
    const execution = result.checks.find((check) => check.name === "Validation execution");

    assert.equal(execution.status, "FAIL");
    assert.equal(result.verdict, "FAIL");
    assert.equal(result.validationEvidence.commands[0].exitCode, 2);
    assert.match(result.validationEvidence.commands[0].stderrSha256, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(result.validationEvidence).includes("private failure"));
  } finally {
    if (previous === undefined) delete process.env.OTITO_TEST_SECRET_OUTPUT;
    else process.env.OTITO_TEST_SECRET_OUTPUT = previous;
  }
});

test("run-validation fails closed when the selected base has no versioned validation policy", () => {
  const root = initRepo("validation-policy-missing");
  writeAndCommit(root, { "src/value.js": "module.exports = 'base';\n" }, "init");
  fs.writeFileSync(path.join(root, "src/value.js"), "module.exports = 'staged';\n");
  git(root, "add", "src/value.js");

  const result = evaluateLocal(root, { base: "HEAD", staged: true, runValidation: true });
  const execution = result.checks.find((check) => check.name === "Validation execution");

  assert.equal(execution.status, "FAIL");
  assert.match(execution.summary, /versioned validation policy/);
});

test("staged convergence receipt is bound to the captured Git index tree", () => {
  const root = initRepo("staged-receipt");
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "node --test" } }),
      "package-lock.json": JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3 }),
      ".gitattributes": "*.ts filter=otito-test\n",
      "src/index.ts": "export const greet = () => 'hi';\n",
      "src/later.ts": "export const later = false;\n",
    },
    "init",
  );
  const filterSentinel = path.join(root, "smudge-filter-ran");
  const filterScript = path.join(root, "smudge-filter.cjs");
  const cleanFilterScript = path.join(root, "clean-filter.cjs");
  fs.writeFileSync(
    filterScript,
    `const fs = require("node:fs"); fs.writeFileSync(${JSON.stringify(filterSentinel)}, "ran"); process.stdin.pipe(process.stdout);\n`,
  );
  fs.writeFileSync(cleanFilterScript, "process.stdin.pipe(process.stdout);\n");
  git(root, "config", "filter.otito-test.clean", `${process.execPath} ${cleanFilterScript}`);
  git(root, "config", "filter.otito-test.smudge", `${process.execPath} ${filterScript}`);
  git(root, "config", "filter.otito-test.required", "true");
  fs.writeFileSync(path.join(root, "src/index.ts"), "export const greet = () => 'hello';\n");
  git(root, "add", "src/index.ts");
  fs.writeFileSync(path.join(root, "src/later.ts"), "export const later = true;\n");
  fs.writeFileSync(path.join(root, ".env"), "SECRET=not-staged\n");

  const first = evaluateLocal(root, { base: "HEAD", staged: true, request: "update the greeting", minConvergence: 0 });
  const expectedTree = git(root, "write-tree").trim();
  const expectedParent = git(root, "rev-parse", "HEAD").trim();
  const convergence = first.checks.find((check) => check.name === "Convergence");

  assert.deepEqual(first.changedFiles, ["src/index.ts"]);
  assert.equal(first.subject.kind, "git-index");
  assert.equal(first.subject.treeSha, expectedTree);
  assert.equal(first.subject.parentSha, expectedParent);
  assert.deepEqual(convergence.subject, first.subject);
  assert.deepEqual(convergence.receipt.subject, first.subject);
  assert.deepEqual(first.receipt, convergence.receipt);
  assert.equal(fs.existsSync(filterSentinel), false, "receipt scoring must not execute configured checkout filters");

  fs.writeFileSync(path.join(root, "src/index.ts"), "export const greet = () => 'replacement-content';\n");
  git(root, "add", "src/index.ts");
  const replacementTree = git(root, "write-tree").trim();
  fs.writeFileSync(path.join(root, "src/index.ts"), "export const greet = () => 'hello';\n");
  git(root, "add", "src/index.ts");
  git(root, "replace", first.subject.treeSha, replacementTree);
  const replaceRefIgnored = evaluateLocal(root, { base: "HEAD", staged: true, request: "update the greeting", minConvergence: 0 });
  assert.equal(replaceRefIgnored.receipt.inputsHash, first.receipt.inputsHash, "local replace refs must not change exact-subject scoring");
  git(root, "replace", "-d", first.subject.treeSha);

  assert.throws(
    () => generateConvergence("update the greeting", { path: root, base: "HEAD", subject: first.subject }),
    /subject and diff files must be supplied together/,
  );
  assert.throws(
    () => generateConvergence("update the greeting", { path: root, base: "HEAD", diffFiles: first.changedFiles }),
    /subject and diff files must be supplied together/,
  );
  assert.throws(
    () => generateConvergence("update the greeting", { path: root, base: "HEAD", subject: first.subject, diffFiles: ["src/later.ts"] }),
    /do not match the staged Git tree subject/,
  );

  fs.writeFileSync(path.join(root, "src/later.ts"), "export function updateGreetingForTheGreetingTask() { return 'highly-relevant-but-unstaged'; }\n");
  const sameIndex = evaluateLocal(root, { base: "HEAD", staged: true, request: "update the greeting", minConvergence: 0 });
  assert.equal(sameIndex.subject.treeSha, first.subject.treeSha);
  assert.equal(sameIndex.receipt.inputsHash, first.receipt.inputsHash, "unstaged source edits must not change a staged-tree receipt");

  const abbreviated = evaluateLocal(root, {
    base: "HEAD",
    staged: true,
    request: "update the greeting",
    receipt: first.receipt.id,
  });
  assert.equal(abbreviated.checks.find((check) => check.name === "Convergence").status, "FAIL");
  assert.match(abbreviated.checks.find((check) => check.name === "Convergence").summary, /full inputs hash/);

  const verified = evaluateLocal(root, {
    base: "HEAD",
    staged: true,
    request: "update the greeting",
    receipt: first.receipt.inputsHash,
  });
  assert.equal(verified.checks.find((check) => check.name === "Convergence").status, "PASS");

  git(root, "add", "src/later.ts");
  const second = evaluateLocal(root, { base: "HEAD", staged: true, request: "update the greeting", minConvergence: 0 });
  assert.notEqual(second.subject.treeSha, first.subject.treeSha);
  assert.notEqual(second.receipt.inputsHash, first.receipt.inputsHash);
});

test("staged receipt preserves legal whitespace and newline characters in paths", () => {
  const root = initRepo("staged-unusual-path");
  const unusualPath = "src/ leading\ntrailing .ts";
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }),
      [unusualPath]: "export const unusual = 'before';\n",
    },
    "init",
  );
  fs.writeFileSync(path.join(root, unusualPath), "export const unusual = 'after';\n");
  git(root, "add", "--", unusualPath);

  const result = evaluateLocal(root, { base: "HEAD", staged: true, request: "update the unusual path", minConvergence: 0 });

  assert.deepEqual(result.changedFiles, [unusualPath]);
  assert.deepEqual(result.receipt.subject, result.subject);
});

test("staged receipt fixes rename detection independently of local Git config", () => {
  const root = initRepo("staged-rename-config");
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }),
      "src/old-name.ts": "export const renamed = true;\n",
    },
    "init",
  );
  git(root, "mv", "src/old-name.ts", "src/new-name.ts");

  git(root, "config", "diff.renames", "false");
  const disabled = evaluateLocal(root, { base: "HEAD", staged: true, request: "rename the source file", minConvergence: 0 });
  git(root, "config", "diff.renames", "copies");
  git(root, "config", "diff.renameLimit", "1");
  git(root, "config", "diff.algorithm", "histogram");
  const copies = evaluateLocal(root, { base: "HEAD", staged: true, request: "rename the source file", minConvergence: 0 });

  assert.deepEqual(disabled.changedFiles, ["src/new-name.ts"]);
  assert.deepEqual(copies.changedFiles, disabled.changedFiles);
  assert.equal(copies.receipt.inputsHash, disabled.receipt.inputsHash);
});

test("staged receipt includes a gitlink change despite submodule ignore config", () => {
  const root = initRepo("staged-gitlink");
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }),
      "src/index.ts": "export const baseline = true;\n",
    },
    "init",
  );
  const firstNestedCommit = git(root, "rev-parse", "HEAD").trim();
  git(root, "update-index", "--add", "--cacheinfo", `160000,${firstNestedCommit},vendor/sub`);
  git(root, "commit", "-q", "-m", "add gitlink");
  const baselineTree = git(root, "rev-parse", "HEAD^{tree}").trim();
  const secondNestedCommit = git(root, "commit-tree", baselineTree, "-p", firstNestedCommit, "-m", "nested next").trim();
  git(root, "update-index", "--cacheinfo", `160000,${secondNestedCommit},vendor/sub`);
  git(root, "config", "diff.ignoreSubmodules", "all");

  const result = evaluateLocal(root, { base: "HEAD", staged: true, request: "update the vendor submodule", minConvergence: 0 });

  assert.deepEqual(result.changedFiles, ["vendor/sub"]);
  assert.equal(result.receipt.receiptVersion, 2);
  assert.deepEqual(result.receipt.subject, result.subject);
});

test("staged receipt fails closed before an oversized source tree is analyzed", () => {
  const root = initRepo("staged-source-limit");
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }),
      "src/index.ts": "export const baseline = true;\n",
    },
    "init",
  );
  fs.writeFileSync(path.join(root, "large-source.ts"), "x".repeat(1024 * 1024));
  const blob = git(root, "hash-object", "-w", "--", "large-source.ts").trim();
  for (let index = 0; index < 65; index += 1) {
    git(root, "update-index", "--add", "--cacheinfo", `100644,${blob},src/generated-${String(index).padStart(2, "0")}.ts`);
  }

  assert.throws(
    () => generateConvergence("add generated sources", { path: root, base: "HEAD", staged: true }),
    /exceeds the safe analysis limit \(5000 files or 64 MiB\)/,
  );
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
  const previous = process.env.OTITO_TIELINE_BIN;
  process.env.OTITO_TIELINE_BIN = bin;
  try {
    const result = evaluateLocal(root, { base: "HEAD" });
    const contracts = result.checks.find((check) => check.name === "Contract drift");
    assert.equal(contracts.status, "PASS");
    assert.match(contracts.summary, /No frontend↔backend contract drift/);
  } finally {
    if (previous === undefined) delete process.env.OTITO_TIELINE_BIN;
    else process.env.OTITO_TIELINE_BIN = previous;
  }
});

test("evaluateLocal gives the tieline installation command when its configured binary is missing", () => {
  const root = initRepo("tieline-missing");
  writeAndCommit(root, { "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }), "src/index.ts": "export const hi = 1;\n" }, "init");
  fs.writeFileSync(path.join(root, "tieline.config.json"), JSON.stringify({ frontend: ".", backend: "." }));

  const result = evaluateLocal(root, { base: "HEAD" });
  const contracts = result.checks.find((check) => check.name === "Contract drift");
  assert.equal(contracts.status, "WARN");
  assert.ok(contracts.details.includes("Repair command: npm install --save-dev @bashbop/tieline"));
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
  const previous = process.env.OTITO_BOUNCER_BIN;
  process.env.OTITO_BOUNCER_BIN = bin;
  try {
    const result = evaluateLocal(root, { base: "HEAD" });
    const compliance = result.checks.find((check) => check.name === "Compliance controls");
    assert.equal(compliance.status, "FAIL");
    assert.match(compliance.summary, /1 required control is missing/);
    assert.ok(compliance.details.some((detail) => detail.includes("Repair action: Add report controls.")));
    assert.ok(compliance.details.some((detail) => detail.includes("Recheck command:")));
  } finally {
    if (previous === undefined) delete process.env.OTITO_BOUNCER_BIN;
    else process.env.OTITO_BOUNCER_BIN = previous;
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
  const previousBin = process.env.OTITO_AIGLARE_BIN;
  const previousOptIn = process.env.OTITO_AIGLARE;
  process.env.OTITO_AIGLARE_BIN = bin;
  process.env.OTITO_AIGLARE = "1";
  try {
    const result = evaluateLocal(root, { base: "HEAD" });
    const governance = result.checks.find((check) => check.name === "AI governance");
    assert.equal(governance.status, "FAIL");
    assert.match(governance.summary, /1 irreversible AI surface lacks/);
  } finally {
    if (previousBin === undefined) delete process.env.OTITO_AIGLARE_BIN;
    else process.env.OTITO_AIGLARE_BIN = previousBin;
    if (previousOptIn === undefined) delete process.env.OTITO_AIGLARE;
    else process.env.OTITO_AIGLARE = previousOptIn;
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
  assert.match(convergence.details.join(" "), /Receipt handle: rcpt_/);

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

test("evaluateLocal makes staged production configuration warnings actionable", () => {
  const root = initRepo("production-config");
  writeAndCommit(
    root,
    {
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "node --test" } }),
      "src/feature-flags/config/environments/production.json": JSON.stringify({ audienceStudio: false }),
    },
    "init",
  );
  fs.writeFileSync(path.join(root, "src/feature-flags/config/environments/production.json"), JSON.stringify({ audienceStudio: true }));
  git(root, "add", "src/feature-flags/config/environments/production.json");

  const result = evaluateLocal(root, { base: "HEAD", staged: true });
  const risk = result.checks.find((check) => check.name === "Risk review");
  assert.equal(risk.status, "WARN");
  assert.ok(risk.details.some((detail) => detail.includes("explicitly approve the production configuration scope")));
  assert.ok(risk.details.some((detail) => detail.includes("git restore --staged -- 'src/feature-flags/config/environments/production.json'")));
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
  assert.match(markdown, /# otito pass/);
  assert.match(markdown, /Verdict:/);
  assert.match(markdown, /Secret safety/);
});
