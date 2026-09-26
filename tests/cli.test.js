import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main } from "../src/cli.js";

const expectedCliVersion = String(JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
let cliRunQueue = Promise.resolve();

function runCli(argv) {
  const run = cliRunQueue.then(
    () => captureCli(argv),
    () => captureCli(argv),
  );
  cliRunQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function captureCli(argv) {
  const stdoutChunks = [];
  const stderrChunks = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => {
    if (typeof chunk !== "string") return originalStdoutWrite(chunk);
    stdoutChunks.push(chunk);
    return true;
  };
  process.stderr.write = (chunk) => {
    if (typeof chunk !== "string") return originalStderrWrite(chunk);
    stderrChunks.push(chunk);
    return true;
  };
  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  let thrown;
  try {
    await main(argv);
  } catch (error) {
    thrown = error;
  }
  const exitCode = process.exitCode ?? 0;
  process.exitCode = previousExitCode;
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
  if (thrown) throw thrown;
  return { stdout: stdoutChunks.join(""), stderr: stderrChunks.join(""), exitCode };
}

function parseJsonOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error(`stdout is empty: ${JSON.stringify(stdout)}`);
  return JSON.parse(trimmed);
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function writeFiles(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

function makeRepoFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otito-cli-"));
  writeFiles(root, {
    "package.json": JSON.stringify({
      name: "fixture-cli",
      version: "0.1.0",
      type: "module",
      scripts: { test: "node --test", lint: "eslint ." },
    }),
    "src/events/events.controller.ts": [
      "import { Controller, Get } from '@nestjs/common';",
      "@Controller('events')",
      "export class EventsController {",
      "  @Get(':id')",
      "  findOne() {}",
      "}",
      "",
    ].join("\n"),
    "tests/events.test.ts": "import test from 'node:test';\ntest('ok', () => {});\n",
  });
  return root;
}

function makeGitFixture(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `otito-cli-git-${prefix}-`));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "commit.gpgsign", "false");
  writeFiles(root, {
    "package.json": JSON.stringify({
      name: "fixture-cli-git",
      version: "1.0.0",
      scripts: { test: "node --test", lint: "eslint ." },
    }),
    "src/index.ts": "export const greet = () => 'hi';\n",
  });
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "init");
  writeFiles(root, { "src/index.ts": "export const greet = () => 'hello';\n" });
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "tweak");
  return root;
}

test("no command falls through to the help handler and exits 0", async () => {
  const result = await runCli([]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Usage:/);
});

test("unknown command prints help and exits 1", async () => {
  const result = await runCli(["definitely-not-a-real-command"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /Usage:/);
});

test("--help on known command prints help and exits 0", async () => {
  const result = await runCli(["doctor", "--help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /otito doctor/);
});

test("explicit help command exits 0", async () => {
  const result = await runCli(["help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Usage:/);
});

test("--version and -v print the exact package version", async () => {
  for (const flag of ["--version", "-v"]) {
    const result = await runCli([flag]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${expectedCliVersion}\n`);
  }
});

test("lightweight commands do not load the TypeScript analysis engine", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const loader = fileURLToPath(new URL("fixtures/reject-typescript-loader.mjs", import.meta.url));

  for (const args of [["--version"], ["help"]]) {
    const result = spawnSync(process.execPath, ["--no-warnings", "--experimental-loader", loader, cli, ...args], {
      cwd: path.dirname(cli),
      encoding: "utf8",
      env: { ...process.env, OTITO_TELEMETRY: "0" },
    });
    assert.equal(result.status, 0, `${args.join(" ")} failed: ${result.stderr}`);
    assert.doesNotMatch(result.stderr, /typescript analysis engine/i);
  }
});

test("error path prints JSON when --json flag is set", async () => {
  const result = await runCli(["impact", "--json"]);
  assert.equal(result.exitCode, 1);
  const payload = parseJsonOutput(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /change request/);
});

test("error path prints to stderr when no --json flag", async () => {
  const result = await runCli(["impact"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /otito: /);
});

test("doctor renders text and json", async () => {
  const json = await runCli(["doctor", "--json"]);
  assert.equal(json.exitCode, 0);
  assert.equal(parseJsonOutput(json.stdout).ok, true);

  const text = await runCli(["doctor", "--no-emoji"]);
  assert.equal(text.exitCode, 0);
  assert.match(text.stdout, /otito doctor/);

  const emojiText = await runCli(["doctor", "--emoji"]);
  assert.equal(emojiText.exitCode, 0);
  assert.match(emojiText.stdout, /otito doctor/);
});

test("repo command renders json and text summary", async () => {
  const fixture = makeRepoFixture();
  const jsonResult = await runCli(["repo", fixture, "--json"]);
  const payload = parseJsonOutput(jsonResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.root, fixture);

  const textResult = await runCli(["repo", fixture]);
  assert.match(textResult.stdout, /otito repo · repository overview/);
  assert.match(textResult.stdout, /At a glance/);
  assert.match(textResult.stdout, /Files scanned:/);
});

test("discover command lists discovered repositories", async () => {
  const fixture = makeRepoFixture();
  const json = await runCli(["discover", path.dirname(fixture), "--depth", "2", "--limit", "20", "--json"]);
  assert.equal(json.exitCode, 0);
  const payload = parseJsonOutput(json.stdout);
  assert.ok(payload, "discover should return a payload");

  const text = await runCli(["discover", path.dirname(fixture), "--depth", "1"]);
  assert.equal(text.exitCode, 0);
  assert.ok(text.stdout.length > 0);
});

test("index, catalog, and search round-trip a catalog", async () => {
  const fixture = makeRepoFixture();
  const catalogFile = path.join(os.tmpdir(), `otito-cli-catalog-${path.basename(fixture)}.json`);

  const indexJson = await runCli(["index", fixture, "--catalog", catalogFile, "--json"]);
  assert.equal(indexJson.exitCode, 0);
  assert.equal(parseJsonOutput(indexJson.stdout).ok, true);

  const indexText = await runCli(["index", fixture, "--catalog", catalogFile]);
  assert.equal(indexText.exitCode, 0);

  const catalogJson = await runCli(["catalog", "--catalog", catalogFile, "--json"]);
  assert.equal(catalogJson.exitCode, 0);
  const catalogText = await runCli(["catalog", "--catalog", catalogFile]);
  assert.equal(catalogText.exitCode, 0);

  const searchJson = await runCli(["search", "events", "--catalog", catalogFile, "--offline", "--limit", "5", "--json"]);
  assert.equal(searchJson.exitCode, 0);
  const searchText = await runCli(["search", "events", "--catalog", catalogFile, "--offline"]);
  assert.equal(searchText.exitCode, 0);

  if (fs.existsSync(catalogFile)) fs.unlinkSync(catalogFile);
});

test("context command emits json, text, and writes an artifact", async () => {
  const fixture = makeRepoFixture();
  const json = await runCli(["context", "add events tool", "--path", fixture, "--json"]);
  assert.equal(json.exitCode, 0);
  assert.equal(parseJsonOutput(json.stdout).ok, true);

  const text = await runCli(["context", "add events tool", "--path", fixture]);
  assert.equal(text.exitCode, 0);
  assert.match(text.stdout, /otito context · repository guide/);
  assert.match(text.stdout, /Primary files/);

  const out = path.join(os.tmpdir(), `otito-cli-context-${Date.now()}.md`);
  const written = await runCli(["context", "add events tool", "--path", fixture, "--out", out]);
  assert.equal(written.exitCode, 0);
  assert.match(written.stdout, /Context pack written/);
  assert.ok(fs.existsSync(out));
  fs.unlinkSync(out);
});

test("context --online adds a model read, and falls back to otito's pack without a key", async (t) => {
  const fixture = makeRepoFixture();
  const savedKey = process.env.TYPESAFE_API_KEY;
  const savedFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = savedKey;
  });

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return /** @type {any} */ ({
      ok: true,
      json: async () => ({ model: "jev-test", answers: { read_intent: { type: "choice", choice: "add", confidence: 0.95, probabilities: { add: 0.96 } } } }),
    });
  };
  process.env.TYPESAFE_API_KEY = "test-key";

  const plain = parseJsonOutput((await runCli(["context", "add events tool", "--path", fixture, "--json"])).stdout);
  assert.equal(plain.modelRead, undefined, "without --online the command makes no call");
  assert.equal(calls, 0);

  const online = parseJsonOutput((await runCli(["context", "add events tool", "--path", fixture, "--json", "--online"])).stdout);
  assert.equal(online.modelRead.source, "jev");
  assert.equal(online.intent.action, "add");
  assert.equal(calls, 1);

  delete process.env.TYPESAFE_API_KEY;
  const unkeyed = await runCli(["context", "add events tool", "--path", fixture, "--online"]);
  assert.equal(unkeyed.exitCode, 0, "a missing key is not a failed command");
  assert.match(unkeyed.stdout, /Model read/);
  assert.match(unkeyed.stdout, /TYPESAFE_API_KEY is not set/);
  assert.equal(calls, 1);
});

test("impact accepts both positional and --path forms and writes artifacts", async () => {
  const fixture = makeRepoFixture();
  const positional = await runCli(["impact", fixture, "rename events controller", "--json"]);
  assert.equal(positional.exitCode, 0);
  assert.equal(parseJsonOutput(positional.stdout).ok, true);

  const withPathFlag = await runCli(["impact", "rename events controller", "--path", fixture, "--json"]);
  assert.equal(withPathFlag.exitCode, 0);

  const text = await runCli(["impact", fixture, "rename events controller"]);
  assert.equal(text.exitCode, 0);
  assert.ok(text.stdout.length > 0);

  const out = path.join(os.tmpdir(), `otito-cli-impact-${Date.now()}.md`);
  const written = await runCli(["impact", fixture, "rename events controller", "--out", out]);
  assert.equal(written.exitCode, 0);
  assert.match(written.stdout, /Change impact written/);
  fs.unlinkSync(out);
});

test("converge --staged emits an exact Git-index subject", async () => {
  const fixture = makeGitFixture("converge-staged");
  fs.writeFileSync(path.join(fixture, "src", "index.ts"), "export const greet = () => 'staged';\n");
  git(fixture, "add", "src/index.ts");
  const expectedTree = git(fixture, "write-tree").trim();

  const result = await runCli(["converge", "update the greeting", "--path", fixture, "--base", "HEAD", "--staged", "--json"]);
  const payload = parseJsonOutput(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(payload.subject.kind, "git-index");
  assert.equal(payload.subject.treeSha, expectedTree);
  assert.deepEqual(payload.receipt.subject, payload.subject);
});

test("converge --head and gate --head score the exact committed change", async () => {
  const fixture = makeGitFixture("converge-head");
  const headSha = git(fixture, "rev-parse", "HEAD").trim();
  fs.writeFileSync(path.join(fixture, "dump.rdb"), "REDIS0011");

  const converged = await runCli(["converge", "update the greeting", "--path", fixture, "--base", "HEAD~1", "--head", "HEAD", "--json"]);
  const payload = parseJsonOutput(converged.stdout);
  assert.equal(converged.exitCode, 0);
  assert.equal(payload.subject.kind, "git-commit");
  assert.equal(payload.subject.headSha, headSha);

  const gated = await runCli([
    "gate",
    fixture,
    "--base",
    "HEAD~1",
    "--head",
    headSha,
    "--request",
    "update the greeting",
    "--receipt",
    payload.receipt.inputsHash,
    "--json",
  ]);
  const gate = parseJsonOutput(gated.stdout);
  assert.equal(gate.scope, "commit");
  assert.equal(gate.checks.find((check) => check.name === "Convergence").status, "PASS");
});

test("gate --run-validation records an exact staged validation receipt", async () => {
  const fixture = makeGitFixture("gate-validation");
  fs.writeFileSync(
    path.join(fixture, "otito.gate.json"),
    JSON.stringify({
      version: 1,
      validation: { commands: [{ id: "unit", command: `${process.execPath} -e "process.exit(0)"` }] },
    }),
  );
  git(fixture, "add", "otito.gate.json");
  git(fixture, "commit", "-q", "-m", "add validation policy");
  fs.writeFileSync(path.join(fixture, "src", "index.ts"), "export const greet = () => 'staged validation';\n");
  git(fixture, "add", "src/index.ts");

  const result = await runCli(["gate", fixture, "--base", "HEAD", "--staged", "--run-validation", "--json"]);
  const payload = parseJsonOutput(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(payload.validationEvidence.commands[0].status, "PASS");
  assert.equal(payload.validationEvidence.receipt.receiptVersion, 1);
  assert.equal(payload.validationEvidence.receipt.subject.treeSha, git(fixture, "write-tree").trim());
});

test("pass evaluates merge readiness on a git fixture", async () => {
  const fixture = makeGitFixture("pass");
  const json = await runCli(["pass", fixture, "--base", "HEAD~1", "--json"]);
  const payload = parseJsonOutput(json.stdout);
  assert.ok(["PASS", "WARN", "FAIL"].includes(payload.verdict));
  assert.equal(json.exitCode, payload.verdict === "FAIL" ? 1 : 0);

  const text = await runCli(["pass", fixture, "--base", "HEAD~1"]);
  assert.ok(text.stdout.length > 0);

  const out = path.join(os.tmpdir(), `otito-cli-pass-${Date.now()}.md`);
  const written = await runCli(["pass", fixture, "--base", "HEAD~1", "--out", out]);
  assert.match(written.stdout, /Pass report written/);
  fs.unlinkSync(out);
});

test("pass-pr surfaces errors when gh is unavailable", async () => {
  const fixture = makeGitFixture("pr");
  const json = await runCli(["pass-pr", "", "--path", fixture, "--json"]);
  const payload = parseJsonOutput(json.stdout);
  assert.ok(payload.verdict || payload.ok === false);
});

test("gate runs the local merge gate without --pr (delegates to pass)", async () => {
  const fixture = makeGitFixture("gate-local");
  const json = await runCli(["gate", fixture, "--base", "HEAD~1", "--json"]);
  const payload = parseJsonOutput(json.stdout);
  assert.ok(["PASS", "WARN", "FAIL"].includes(payload.verdict), "gate local mode yields a PASS/WARN/FAIL verdict");
  assert.equal(json.exitCode, payload.verdict === "FAIL" ? 1 : 0);

  const text = await runCli(["gate", fixture, "--base", "HEAD~1"]);
  assert.ok(text.stdout.length > 0);
});

test("gate --pr routes to the GitHub PR gate (delegates to pass-pr)", async () => {
  const fixture = makeGitFixture("gate-pr");
  // Without gh / a real PR this surfaces a verdict or an ok:false error — what
  // matters is that --pr <selector> routes through the PR gate, not the local one.
  const json = await runCli(["gate", "--pr", "123", "--path", fixture, "--json"]);
  const payload = parseJsonOutput(json.stdout);
  assert.ok(payload.verdict || payload.ok === false, "gate --pr produces a PR-gate result or a surfaced error");
});

test("gate takes the repository from the positional or --path, and refuses two different ones", async (t) => {
  withEmptyUserConfig(t);
  const fixture = makeGitFixture("gate-repo");
  fs.writeFileSync(path.join(fixture, ".otitorc.json"), JSON.stringify({ policy: "high-risk", governance: "solo" }));
  // Run from another repository, so a gate that dropped the one it was given
  // would gate this one instead, under this one's config.
  const cwd = makeGitFixture("gate-repo-cwd");
  fs.writeFileSync(path.join(cwd, ".otitorc.json"), JSON.stringify({ policy: "company", governance: "team" }));
  withCwd(t, cwd);
  const gate = async (...argv) => {
    const report = parseJsonOutput((await runCli(["gate", ...argv, "--base", "HEAD~1", "--json"])).stdout);
    return { root: report.repo?.root, policy: report.policy, governance: report.governance };
  };
  const gated = { root: fs.realpathSync(fixture), policy: "high-risk", governance: "solo" };

  assert.deepEqual(await gate(fixture), gated, "the positional names the repository");
  assert.deepEqual(await gate("--path", fixture), gated, "so does --path");
  assert.deepEqual(await gate(fixture, "--path", fixture), gated, "both may name it");
  assert.deepEqual(
    await gate(".", "--path", cwd),
    { root: fs.realpathSync(cwd), policy: "company", governance: "team" },
    "two spellings of one directory are one repository",
  );

  const refused = await runCli(["gate", fixture, "--path", cwd, "--base", "HEAD~1", "--json"]);
  assert.equal(refused.exitCode, 1);
  assert.equal(parseJsonOutput(refused.stdout).error, `gate was given two repositories (${fixture} and --path ${cwd}); pass only one`);
  const bare = await runCli(["gate", "--path", "--json"]);
  assert.equal(bare.exitCode, 1);
  assert.equal(parseJsonOutput(bare.stdout).error, "gate --path needs a repository, e.g. `otito gate --path .`");
});

test("gate --pr takes the repository from the positional or --path, and refuses two different ones", async (t) => {
  withEmptyUserConfig(t);
  const fixture = makeGitFixture("gate-pr-repo");
  fs.writeFileSync(path.join(fixture, ".otitorc.json"), JSON.stringify({ governance: "solo" }));
  withFakeGh(t, pullRequest42(fixture));
  // Run from another repository, one with no config, so a gate that dropped
  // the one it was given would gate this one instead, under team governance.
  const cwd = makeGitFixture("gate-pr-repo-cwd");
  withCwd(t, cwd);
  const gate = async (...argv) => {
    const report = parseJsonOutput((await runCli(["gate", ...argv, "--json"])).stdout);
    return { root: report.repo?.root, pr: report.pr?.number, governance: report.governance };
  };
  const gated = { root: fs.realpathSync(fixture), pr: 42, governance: "solo" };

  assert.deepEqual(await gate(fixture, "--pr", "42"), gated, "the positional names the repository");
  assert.deepEqual(await gate("--pr", "42", "--path", fixture), gated, "so does --path");
  assert.deepEqual(await gate(fixture, "--pr", "42", "--path", fixture), gated, "both may name it");

  const refused = await runCli(["gate", fixture, "--pr", "42", "--path", cwd, "--json"]);
  assert.equal(refused.exitCode, 1);
  assert.equal(parseJsonOutput(refused.stdout).error, `gate was given two repositories (${fixture} and --path ${cwd}); pass only one`);
});

test("help lists the gate command and the canonical-vs-legacy guidance", async () => {
  const result = await runCli(["help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /otito gate/);
  assert.match(result.stdout, /Canonical vs legacy/);
  // The legacy MCP tool note once promised removal "until 3.0" and linked
  // docs/MIGRATION-2.0.md, which the otito rebrand deleted; the section it
  // links now has to exist.
  assert.doesNotMatch(result.stdout, /until 3\.0|MIGRATION-2\.0/);
  assert.match(result.stdout, /https:\/\/bashbop\.github\.io\/otito\/02-mcp-agent-workflows\/#legacy-tool-names/);
  const mcpDoc = fs.readFileSync(new URL("../docs/02-mcp-agent-workflows/README.md", import.meta.url), "utf8");
  assert.match(mcpDoc, /^### Legacy tool names$/m);
});

test("review runs the composite review on a git fixture", async () => {
  const fixture = makeGitFixture("review");
  const json = await runCli(["review", fixture, "tweak greeting", "--base", "HEAD~1", "--json"]);
  const payload = parseJsonOutput(json.stdout);
  assert.ok(payload.verdict || payload.summary || payload.impact);

  const text = await runCli(["review", fixture, "tweak greeting", "--base", "HEAD~1"]);
  assert.ok(text.stdout.length > 0);
});

test("review takes the repository from --path or the positional, and the request from the positionals left", async (t) => {
  withEmptyUserConfig(t);
  const fixture = makeGitFixture("review-repo");
  fs.writeFileSync(path.join(fixture, ".otitorc.json"), JSON.stringify({ policy: "high-risk", governance: "solo" }));
  // Run from another repository, so a review that dropped the one it was given
  // would review this one instead, under this one's config.
  const cwd = makeGitFixture("review-repo-cwd");
  fs.writeFileSync(path.join(cwd, ".otitorc.json"), JSON.stringify({ policy: "company", governance: "team" }));
  withCwd(t, cwd);
  const review = async (...argv) => {
    const report = parseJsonOutput((await runCli(["review", ...argv, "--base", "HEAD~1", "--json"])).stdout);
    return { root: report.repo?.root, request: report.request, policy: report.pass?.policy, governance: report.pass?.governance };
  };
  const reviewed = { root: fs.realpathSync(fixture), policy: "high-risk", governance: "solo" };

  assert.deepEqual(await review("--path", fixture), { ...reviewed, request: "review this change" }, "--path names the repository");
  assert.deepEqual(await review("--path", fixture, "tweak greeting"), { ...reviewed, request: "tweak greeting" }, "every positional is then the request");
  assert.deepEqual(await review("tweak", "greeting", "--path", fixture), { ...reviewed, request: "tweak greeting" }, "wherever --path sits");
  assert.deepEqual(await review(fixture, "tweak greeting"), { ...reviewed, request: "tweak greeting" }, "without --path the first positional names it");

  const bare = await runCli(["review", "--path", "--json"]);
  assert.equal(bare.exitCode, 1);
  assert.equal(parseJsonOutput(bare.stdout).error, "review --path needs a repository, e.g. `otito review --path .`");
});

test("review --pr takes the repository from --path or the positional", async (t) => {
  withEmptyUserConfig(t);
  const fixture = makeGitFixture("review-pr-repo");
  fs.writeFileSync(path.join(fixture, ".otitorc.json"), JSON.stringify({ governance: "solo" }));
  withFakeGh(t, pullRequest42(fixture));
  // Run from another repository, one with no config, so a review that dropped
  // the one it was given would review this one instead, under team governance.
  withCwd(t, makeGitFixture("review-pr-repo-cwd"));
  const review = async (...argv) => {
    const report = parseJsonOutput((await runCli(["review", ...argv, "--pr", "42", "--json"])).stdout);
    return { root: report.repo?.root, governance: report.pass?.governance };
  };
  const reviewed = { root: fs.realpathSync(fixture), governance: "solo" };

  assert.deepEqual(await review("--path", fixture), reviewed, "--path names the repository");
  assert.deepEqual(await review(fixture), reviewed, "so does the positional");
});

// Pin the user config tier to an empty directory, so a developer's own
// ~/.config/otito/config.json cannot decide a gate's policy or governance.
function withEmptyUserConfig(t) {
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "otito-cli-xdg-"));
  t.after(() => {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
  });
}

// Run otito from `dir`, the way `otito pass ../other-repo` runs from inside
// one repository while gating another.
function withCwd(t, dir) {
  const saved = process.cwd();
  process.chdir(dir);
  t.after(() => process.chdir(saved));
}

function makeConfiguredDir(prefix, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `otito-cli-${prefix}-`));
  fs.writeFileSync(path.join(dir, ".otitorc.json"), JSON.stringify(config));
  return dir;
}

// Put a `gh` on PATH that answers the GitHub gate from canned JSON, keyed by
// argument prefix, so a PR-mode gate runs evaluatePR end to end offline.
function withFakeGh(t, responses) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "otito-cli-gh-"));
  const gh = path.join(bin, "gh");
  fs.writeFileSync(
    gh,
    [
      "#!/usr/bin/env node",
      `const responses = ${JSON.stringify(responses)};`,
      "const joined = process.argv.slice(2).join(' ');",
      "const key = Object.keys(responses).find((prefix) => joined === prefix || joined.startsWith(prefix + ' '));",
      "if (key === undefined) {",
      "  console.error('unexpected gh args: ' + joined);",
      "  process.exit(1);",
      "}",
      "process.stdout.write(responses[key]);",
      "",
    ].join("\n"),
  );
  fs.chmodSync(gh, 0o755);
  const saved = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${saved}`;
  t.after(() => {
    process.env.PATH = saved;
  });
}

// What `gh` answers for org/repo#42: an open PR whose base and head are the
// fixture's last two commits, changing src/index.ts, awaiting a CODEOWNERS
// review that branch protection requires.
function pullRequest42(fixture) {
  return {
    "pr view": JSON.stringify({
      number: 42,
      title: "Tweak greeting",
      url: "https://github.com/org/repo/pull/42",
      state: "OPEN",
      mergedAt: null,
      baseRefName: "main",
      baseRefOid: git(fixture, "rev-parse", "HEAD~1").trim(),
      headRefOid: git(fixture, "rev-parse", "HEAD").trim(),
      changedFiles: 1,
      isDraft: false,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      reviewDecision: "REVIEW_REQUIRED",
      files: [{ path: "src/index.ts" }],
      reviews: [],
      statusCheckRollup: [{ name: "tests", conclusion: "SUCCESS" }],
    }),
    "repo view": JSON.stringify({ nameWithOwner: "org/repo" }),
    "api graphql": JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } }),
    "api repos/org/repo/branches/main/protection": JSON.stringify({
      required_pull_request_reviews: { required_approving_review_count: 1, require_code_owner_reviews: true },
      required_status_checks: { contexts: ["tests"], checks: [{ context: "tests" }] },
      required_conversation_resolution: { enabled: true },
    }),
  };
}

test("pass, gate and review take policy and governance from the gated repository's config, not the directory otito runs in", async (t) => {
  withEmptyUserConfig(t);
  const configured = makeGitFixture("gate-config");
  fs.writeFileSync(path.join(configured, ".otitorc.json"), JSON.stringify({ policy: "high-risk", governance: "solo", emoji: false }));
  const unconfigured = makeGitFixture("gate-no-config");
  // The directory otito runs in names other settings, so a lookup from the cwd
  // instead of the gated repository would show in every assertion below.
  withCwd(t, makeConfiguredDir("gate-cwd", { policy: "company", governance: "team", emoji: true }));
  const gate = async (...argv) => parseJsonOutput((await runCli([...argv, "--base", "HEAD~1", "--json"])).stdout);
  const settings = (report) => ({ policy: report.policy, governance: report.governance });

  assert.deepEqual(settings(await gate("pass", configured)), { policy: "high-risk", governance: "solo" }, "pass reads the gated repository's .otitorc.json");
  assert.deepEqual(settings(await gate("gate", configured)), { policy: "high-risk", governance: "solo" }, "gate reads it too");
  assert.deepEqual(settings((await gate("review", configured)).pass), { policy: "high-risk", governance: "solo" }, "review gates under it");
  assert.deepEqual(
    settings(await gate("pass", unconfigured)),
    { policy: "standard", governance: "team" },
    "a repository with no config gets the defaults, not the cwd's",
  );
  assert.deepEqual(
    settings(await gate("pass", configured, "--policy", "standard", "--governance", "team")),
    { policy: "standard", governance: "team" },
    "an explicit flag still wins",
  );
  assert.deepEqual(
    settings(await gate("pass", configured, "--policy=", "--governance=")),
    { policy: "high-risk", governance: "solo" },
    "a blank flag counts as omitted",
  );

  // Rendering preferences still come from the directory otito runs in.
  const text = await runCli(["pass", configured, "--base", "HEAD~1"]);
  assert.match(text.stdout, /📋 {2}otito pass/);
});

test("pass-pr, gate --pr and review --pr take the config of the repository they gate", async (t) => {
  withEmptyUserConfig(t);
  const fixture = makeGitFixture("gate-pr-config");
  writeFiles(fixture, {
    ".otitorc.json": JSON.stringify({ governance: "solo" }),
    ".github/CODEOWNERS": "src/index.ts @alice\n",
  });
  withFakeGh(t, pullRequest42(fixture));
  // `otito pass-pr 42 --path <repo>` run from another directory, one whose
  // config says team.
  withCwd(t, makeConfiguredDir("gate-pr-cwd", { governance: "team" }));
  const gate = async (...argv) => parseJsonOutput((await runCli([...argv, "--json"])).stdout);
  const codeowners = (report) => report.checks.find((check) => check.name === "CODEOWNERS");

  for (const argv of [
    ["pass-pr", "42", "--path", fixture],
    ["gate", "--pr", "42", "--path", fixture],
  ]) {
    const report = await gate(...argv);
    assert.equal(report.governance, "solo", `${argv[0]} reads the --path repository's .otitorc.json`);
    assert.equal(codeowners(report).status, "WARN");
    assert.match(codeowners(report).summary, /solo-maintainer mode requires an explicit owner\/admin merge decision/);
  }
  const review = await gate("review", fixture, "--pr", "42");
  assert.equal(review.pass.governance, "solo", "review --pr reads the positional repository's .otitorc.json");
  assert.equal(codeowners(review.pass).status, "WARN");

  const team = await gate("pass-pr", "42", "--path", fixture, "--governance", "team");
  assert.equal(team.governance, "team", "an explicit --governance still wins");
  assert.equal(codeowners(team).status, "FAIL");
  assert.equal(team.verdict, "FAIL");
});

test("workspace-gate runs every repository under the config they agree on, and refuses configs that disagree", async (t) => {
  withEmptyUserConfig(t);
  const stage = (repo) => {
    fs.writeFileSync(path.join(repo, "src", "index.ts"), "export const greet = () => 'staged';\n");
    git(repo, "add", "src/index.ts");
    return repo;
  };
  const web = stage(makeGitFixture("workspace-web"));
  const api = stage(makeGitFixture("workspace-api"));
  fs.writeFileSync(path.join(api, ".otitorc.json"), JSON.stringify({ governance: "solo" }));
  withCwd(t, makeConfiguredDir("workspace-cwd", { governance: "team" }));
  const workspaceGate = async (...flags) => {
    const result = await runCli(["workspace-gate", web, api, "--base", "HEAD", ...flags, "--json"]);
    return { exitCode: result.exitCode, report: parseJsonOutput(result.stdout) };
  };
  const governance = (report) => [report.governance, ...report.repositories.map((entry) => entry.gate.governance)];

  // One receipt records one governance for the whole change, so web's team
  // and api's solo cannot both hold.
  const refused = await workspaceGate();
  assert.equal(refused.exitCode, 1);
  assert.equal(refused.report.ok, false);
  assert.ok(refused.report.error.includes(`(${web}: team, ${api}: solo)`), refused.report.error);
  assert.match(refused.report.error, /pass --governance to choose it$/);

  const settled = await workspaceGate("--governance", "team");
  assert.deepEqual(governance(settled.report), ["team", "team", "team"], "the flag settles it for every repository");
  assert.ok(settled.report.receipt, "the settled workspace still gets its parent receipt");

  // When each repository's own config agrees, that is the setting, whatever
  // the directory otito runs in says.
  fs.writeFileSync(path.join(web, ".otitorc.json"), JSON.stringify({ governance: "solo" }));
  const agreed = await workspaceGate();
  assert.deepEqual(governance(agreed.report), ["solo", "solo", "solo"]);
});

test("map renders json, markdown, and writes an artifact", async () => {
  const fixture = makeRepoFixture();
  const json = await runCli(["map", fixture, "--json"]);
  assert.equal(json.exitCode, 0);
  assert.equal(parseJsonOutput(json.stdout).ok, true);

  // The terminal view is rendered now, so assert on the report's content
  // rather than on Markdown syntax. `--out` and `--json` still emit raw.
  const text = await runCli(["map", fixture]);
  assert.match(text.stdout, /CODE MAP/);
  assert.match(text.stdout, /Source files:/);

  const out = path.join(os.tmpdir(), `otito-cli-map-${Date.now()}.md`);
  const written = await runCli(["map", fixture, "--out", out]);
  assert.match(written.stdout, /Code map written/);
  fs.unlinkSync(out);
});

test("structure surfaces an install hint when the underlying tool is missing", async () => {
  const fixture = makeRepoFixture();
  const json = await runCli(["structure", fixture, "--json"]);
  const payload = parseJsonOutput(json.stdout);
  if (!payload.ok) {
    assert.equal(json.exitCode, 1);
    const text = await runCli(["structure", fixture]);
    assert.match(text.stdout, /Structure generation skipped/);
    assert.equal(text.exitCode, 1);
  } else {
    assert.equal(json.exitCode, 0);
  }
});

test("deps requires a name and resolves an installed package", async () => {
  const missing = await runCli(["deps"]);
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stderr, /package name/);

  const installed = await runCli(["deps", "typescript", "--json"]);
  if (installed.exitCode === 0) {
    assert.equal(parseJsonOutput(installed.stdout).ok, true);
    const text = await runCli(["deps", "typescript", "--query", "compileFunction", "--limit", "3"]);
    assert.ok(text.stdout.length > 0);
  }

  const bogus = await runCli(["deps", "definitely-not-real-pkg-xyz123", "--json"]);
  if (bogus.exitCode !== 0) {
    assert.equal(parseJsonOutput(bogus.stdout).ok, false);
  }
});

test("matrix renders the tool matrix", async () => {
  const json = await runCli(["matrix", "--json"]);
  assert.equal(json.exitCode, 0);
  const payload = parseJsonOutput(json.stdout);
  assert.ok(Array.isArray(payload.tools));

  const text = await runCli(["matrix"]);
  assert.match(text.stdout, /Tool Evaluation Matrix/);
});

test("init scaffolds a project into a target directory", async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "otito-cli-init-"));
  const json = await runCli(["init", target, "--force", "--no-workflow", "--json"]);
  assert.equal(json.exitCode, 0);
  const payload = parseJsonOutput(json.stdout);
  assert.ok(payload, "init should return a payload");

  const text = await runCli(["init", target, "--force", "--no-workflow"]);
  assert.equal(text.exitCode, 0);
});

test("pr renders json, text, and writes an artifact", async () => {
  const fixture = makeGitFixture("pr-review");
  const json = await runCli(["pr", fixture, "--base", "HEAD~1", "--json"]);
  assert.equal(json.exitCode, 0);
  const payload = parseJsonOutput(json.stdout);
  assert.ok(payload.ok || payload.changedFiles);

  const text = await runCli(["pr", fixture, "--base", "HEAD~1"]);
  assert.ok(text.stdout.length > 0);

  const out = path.join(os.tmpdir(), `otito-cli-pr-${Date.now()}.md`);
  const written = await runCli(["pr", fixture, "--base", "HEAD~1", "--out", out]);
  assert.match(written.stdout, /PR review context written/);
  fs.unlinkSync(out);
});

test("report renders json and text", async () => {
  const fixture = makeRepoFixture();
  const json = await runCli(["report", fixture, "--json"]);
  assert.equal(json.exitCode, 0);
  assert.ok(parseJsonOutput(json.stdout));

  const text = await runCli(["report", fixture]);
  assert.ok(text.stdout.length > 0);

  const out = path.join(os.tmpdir(), `otito-cli-report-${Date.now()}.md`);
  const written = await runCli(["report", fixture, "--out", out]);
  assert.match(written.stdout, /Report written/);
  fs.unlinkSync(out);
});

test("workspace requires at least two repos and produces a multi-repo summary", async () => {
  const failure = await runCli(["workspace", makeRepoFixture()]);
  assert.equal(failure.exitCode, 1);
  assert.match(failure.stderr, /workspace requires at least two/);

  const fixtureA = makeRepoFixture();
  const fixtureB = makeRepoFixture();
  const json = await runCli(["workspace", fixtureA, fixtureB, "--json"]);
  assert.equal(json.exitCode, 0);
  assert.ok(parseJsonOutput(json.stdout));

  const text = await runCli(["workspace", fixtureA, fixtureB]);
  assert.ok(text.stdout.length > 0);

  const out = path.join(os.tmpdir(), `otito-cli-workspace-${Date.now()}.md`);
  const written = await runCli(["workspace", fixtureA, fixtureB, "--out", out]);
  assert.match(written.stdout, /Workspace report written/);
  fs.unlinkSync(out);
});

test("harness renders json, text, and writes an artifact", async () => {
  const fixture = makeRepoFixture();
  const json = await runCli(["harness", fixture, "--json"]);
  assert.equal(json.exitCode, 0);

  const text = await runCli(["harness", fixture]);
  assert.ok(text.stdout.length > 0);

  const out = path.join(os.tmpdir(), `otito-cli-harness-${Date.now()}.md`);
  const written = await runCli(["harness", fixture, "--out", out]);
  assert.match(written.stdout, /Harness written/);
  fs.unlinkSync(out);
});

test("eval and data-access produce reports", async () => {
  const fixture = makeRepoFixture();
  const evalJson = await runCli(["eval", fixture, "--query", "events", "--json"]);
  assert.equal(evalJson.exitCode, 0);

  const evalText = await runCli(["eval", fixture, "--query", "events"]);
  assert.ok(evalText.stdout.length > 0);

  const evalOut = path.join(os.tmpdir(), `otito-cli-eval-${Date.now()}.md`);
  const evalWritten = await runCli(["eval", fixture, "--out", evalOut]);
  assert.match(evalWritten.stdout, /Eval written/);
  fs.unlinkSync(evalOut);

  const daJson = await runCli(["data-access", fixture, "--json"]);
  assert.equal(daJson.exitCode, 0);

  const daText = await runCli(["data-access", fixture]);
  assert.ok(daText.stdout.length > 0);

  const daOut = path.join(os.tmpdir(), `otito-cli-data-${Date.now()}.md`);
  const daWritten = await runCli(["data-access", fixture, "--out", daOut]);
  assert.match(daWritten.stdout, /Data-access report written/);
  fs.unlinkSync(daOut);
});

test("agent-tools renders json and markdown", async () => {
  const json = await runCli(["agent-tools", "--json"]);
  assert.equal(json.exitCode, 0);
  const payload = parseJsonOutput(json.stdout);
  assert.ok(Array.isArray(payload.tools));

  const markdown = await runCli(["agent-tools", "--markdown"]);
  assert.equal(markdown.exitCode, 0);
  assert.match(markdown.stdout, /# Agent Tool Surface/);
});

test("install --json reports an outcome without throwing", async () => {
  const result = await runCli(["install", "--json"]);
  const payload = parseJsonOutput(result.stdout);
  assert.ok(payload && typeof payload === "object");
});

test("eval --accuracy runs the labeled corpus and reports a passing scoreboard", async () => {
  const result = await runCli(["eval", "--accuracy", "--json"]);
  assert.equal(result.exitCode, 0, "baseline corpus run must exit 0");
  const payload = parseJsonOutput(result.stdout);
  assert.equal(payload.passed, true, "corpus thresholds must hold at baseline");
  assert.ok(payload.scoreboard.retrieval.pAtK >= 0.85);
  assert.ok(payload.scoreboard.risk.accuracy >= 0.95);
});

test("eval --harness runs the isolated fixture command corpus", async () => {
  const result = await runCli(["eval", "--harness", "--json"]);
  assert.equal(result.exitCode, 0, "harness execution corpus must exit 0 at baseline");
  const payload = parseJsonOutput(result.stdout);
  assert.equal(payload.evalKind, "harness-execution");
  assert.equal(payload.passed, true);
  assert.equal(payload.counts.passedCommands, 4);
});

test("eval --gate-effectiveness runs committed staged changes through the real gate", async () => {
  const result = await runCli(["eval", "--gate-effectiveness", "--json"]);
  assert.equal(result.exitCode, 0, "gate-effectiveness corpus must exit 0 at baseline");
  const payload = parseJsonOutput(result.stdout);
  assert.equal(payload.evalKind, "gate-effectiveness");
  assert.equal(payload.passed, true);
  assert.equal(payload.counts.cases, 9);
  assert.equal(payload.counts.blockedAsExpected, 7);
});
