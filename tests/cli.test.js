import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { main } from "../src/cli.js";

async function runCli(argv) {
  const stdoutChunks = [];
  const stderrChunks = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  process.stderr.write = (chunk) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repoctx-cli-"));
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `repoctx-cli-git-${prefix}-`));
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
  assert.match(result.stdout, /repoctx doctor/);
});

test("explicit help command exits 0", async () => {
  const result = await runCli(["help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Usage:/);
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
  assert.match(result.stderr, /repoctx: /);
});

test("doctor renders text and json", async () => {
  const json = await runCli(["doctor", "--json"]);
  assert.equal(json.exitCode, 0);
  assert.equal(parseJsonOutput(json.stdout).ok, true);

  const text = await runCli(["doctor", "--no-emoji"]);
  assert.equal(text.exitCode, 0);
  assert.match(text.stdout, /repoctx doctor/);

  const emojiText = await runCli(["doctor", "--emoji"]);
  assert.equal(emojiText.exitCode, 0);
  assert.match(emojiText.stdout, /repoctx doctor/);
});

test("repo command renders json and text summary", async () => {
  const fixture = makeRepoFixture();
  const jsonResult = await runCli(["repo", fixture, "--json"]);
  const payload = parseJsonOutput(jsonResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.root, fixture);

  const textResult = await runCli(["repo", fixture]);
  assert.match(textResult.stdout, /# Repo:/);
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
  const catalogFile = path.join(os.tmpdir(), `repoctx-cli-catalog-${path.basename(fixture)}.json`);

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
  assert.match(text.stdout, /Context Pack/);

  const out = path.join(os.tmpdir(), `repoctx-cli-context-${Date.now()}.md`);
  const written = await runCli(["context", "add events tool", "--path", fixture, "--out", out]);
  assert.equal(written.exitCode, 0);
  assert.match(written.stdout, /Context pack written/);
  assert.ok(fs.existsSync(out));
  fs.unlinkSync(out);
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

  const out = path.join(os.tmpdir(), `repoctx-cli-impact-${Date.now()}.md`);
  const written = await runCli(["impact", fixture, "rename events controller", "--out", out]);
  assert.equal(written.exitCode, 0);
  assert.match(written.stdout, /Change impact written/);
  fs.unlinkSync(out);
});

test("pass evaluates merge readiness on a git fixture", async () => {
  const fixture = makeGitFixture("pass");
  const json = await runCli(["pass", fixture, "--base", "HEAD~1", "--json"]);
  const payload = parseJsonOutput(json.stdout);
  assert.ok(["PASS", "WARN", "FAIL"].includes(payload.verdict));
  assert.equal(json.exitCode, payload.verdict === "FAIL" ? 1 : 0);

  const text = await runCli(["pass", fixture, "--base", "HEAD~1"]);
  assert.ok(text.stdout.length > 0);

  const out = path.join(os.tmpdir(), `repoctx-cli-pass-${Date.now()}.md`);
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

test("help lists the gate command and the canonical-vs-legacy guidance", async () => {
  const result = await runCli(["help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /repoctx gate/);
  assert.match(result.stdout, /Canonical vs legacy/);
  assert.match(result.stdout, /MIGRATION-2\.0\.md/);
});

test("review runs the composite review on a git fixture", async () => {
  const fixture = makeGitFixture("review");
  const json = await runCli(["review", fixture, "tweak greeting", "--base", "HEAD~1", "--json"]);
  const payload = parseJsonOutput(json.stdout);
  assert.ok(payload.verdict || payload.summary || payload.impact);

  const text = await runCli(["review", fixture, "tweak greeting", "--base", "HEAD~1"]);
  assert.ok(text.stdout.length > 0);
});

test("map renders json, markdown, and writes an artifact", async () => {
  const fixture = makeRepoFixture();
  const json = await runCli(["map", fixture, "--json"]);
  assert.equal(json.exitCode, 0);
  assert.equal(parseJsonOutput(json.stdout).ok, true);

  const text = await runCli(["map", fixture]);
  assert.match(text.stdout, /# /);

  const out = path.join(os.tmpdir(), `repoctx-cli-map-${Date.now()}.md`);
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
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "repoctx-cli-init-"));
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

  const out = path.join(os.tmpdir(), `repoctx-cli-pr-${Date.now()}.md`);
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

  const out = path.join(os.tmpdir(), `repoctx-cli-report-${Date.now()}.md`);
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

  const out = path.join(os.tmpdir(), `repoctx-cli-workspace-${Date.now()}.md`);
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

  const out = path.join(os.tmpdir(), `repoctx-cli-harness-${Date.now()}.md`);
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

  const evalOut = path.join(os.tmpdir(), `repoctx-cli-eval-${Date.now()}.md`);
  const evalWritten = await runCli(["eval", fixture, "--out", evalOut]);
  assert.match(evalWritten.stdout, /Eval written/);
  fs.unlinkSync(evalOut);

  const daJson = await runCli(["data-access", fixture, "--json"]);
  assert.equal(daJson.exitCode, 0);

  const daText = await runCli(["data-access", fixture]);
  assert.ok(daText.stdout.length > 0);

  const daOut = path.join(os.tmpdir(), `repoctx-cli-data-${Date.now()}.md`);
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
