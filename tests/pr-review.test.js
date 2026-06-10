import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { formatPrCommentMarkdown, generatePrReview } from "../src/lib/pr-review.js";

test("generatePrReview summarizes branch diff with risk and test hints", () => {
  const fixture = createPrFixture();

  const result = generatePrReview(fixture, { base: "main" });
  assert.equal(result.data.ok, true);
  assert.equal(result.data.comparison.changedFileCount, 1);
  assert.equal(result.data.changedFiles[0].path, "src/booking/booking.controller.ts");
  assert.equal(result.data.changedFiles[0].kind, "controller");
  assert.equal(result.data.changedFiles[0].domain, "booking");
  assert.ok(result.data.risk.flags.includes("request surface"));
  assert.ok(result.data.risk.flags.includes("no test files changed"));
  assert.ok(result.data.testHints.some((hint) => hint.command === "npm test"));
  assert.match(result.markdown, /## Changed Files/);

  const comment = formatPrCommentMarkdown(result.data);
  assert.match(comment, /<!-- repoctx-pr-review -->/);
  assert.match(comment, /repoctx PR Review/);
  assert.match(comment, /Risky Files/);
});

test("generatePrReview can create a sticky PR comment through gh", () => {
  const fixture = createPrFixture();
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-gh-"));
  const fakeGh = path.join(fakeBin, "gh");
  fs.writeFileSync(
    fakeGh,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "if (args[0] === 'pr' && args[1] === 'view') {",
      "  console.log(JSON.stringify({ number: 123, title: 'Test PR', baseRefName: 'main', headRefName: 'HEAD', comments: [], reviews: [], files: [] }));",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'repo' && args[1] === 'view') {",
      "  console.log(JSON.stringify({ nameWithOwner: 'example/repoctx' }));",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'api') {",
      "  const endpoint = args[1];",
      "  if (endpoint === 'repos/example/repoctx/pulls/123/comments') {",
      "    console.log('[]');",
      "    process.exit(0);",
      "  }",
      "  if (endpoint === 'repos/example/repoctx/issues/123/comments?per_page=100') {",
      "    console.log('[]');",
      "    process.exit(0);",
      "  }",
      "  if (endpoint === 'repos/example/repoctx/issues/123/comments') {",
      "    const inputPath = args[args.indexOf('--input') + 1];",
      "    const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));",
      "    if (!payload.body.includes('<!-- repoctx-pr-review -->')) process.exit(2);",
      "    console.log(JSON.stringify({ id: 77, html_url: 'https://example.test/comment' }));",
      "    process.exit(0);",
      "  }",
      "}",
      "console.error(`unexpected gh args: ${args.join(' ')}`);",
      "process.exit(1);",
      "",
    ].join("\n"),
  );
  fs.chmodSync(fakeGh, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
  try {
    const result = generatePrReview(fixture, { base: "main", number: 123, comment: true });
    assert.deepEqual(result.data.comment, {
      ok: true,
      action: "created",
      id: 77,
      url: "https://example.test/comment",
    });
  } finally {
    process.env.PATH = originalPath;
  }
});

test("generatePrReview recognizes Go test files and suggests Go verification", () => {
  const fixture = createGoPrFixture();

  const result = generatePrReview(fixture, { base: "main" });
  const testFile = result.data.changedFiles.find((file) => file.path === "internal/githubpr/evaluate_test.go");

  assert.ok(testFile);
  assert.equal(testFile.kind, "test");
  assert.ok(!result.data.risk.flags.includes("no test files changed"));
  assert.ok(result.data.reviewTargets.testFiles.includes("internal/githubpr/evaluate_test.go"));
  assert.ok(result.data.testHints.some((hint) => hint.command === "go test ./..."));
});

test("generatePrReview falls back to Go test classification when files are not in the code map", () => {
  const fixture = createDeletedGoTestFixture();

  const result = generatePrReview(fixture, { base: "main" });
  const fixtureTest = result.data.changedFiles.find((file) => file.path === "internal/githubpr/obsolete_test.go");

  assert.ok(fixtureTest);
  assert.equal(fixtureTest.kind, "test");
});

// --- Finding #6: shared classifier; a tokens.js util is not flagged auth/security ---

test("generatePrReview does not flag a tokens.js utility as auth/security", () => {
  const fixture = createSubstringRiskFixture();

  const result = generatePrReview(fixture, { base: "main" });
  const tokensFile = result.data.changedFiles.find((file) => file.path === "src/lib/tokens.js");

  assert.ok(tokensFile, `tokens.js missing from changed files: ${result.data.changedFiles.map((f) => f.path).join(", ")}`);
  assert.ok(!tokensFile.riskFlags.includes("auth/security"), `tokens.js should not be auth/security, got ${tokensFile.riskFlags.join(", ")}`);
  assert.ok(!result.data.risk.flags.includes("auth/security"), `PR risk should not include auth/security, got ${result.data.risk.flags.join(", ")}`);
});

test("generatePrReview still flags a genuine token.service.ts change as auth/security via the shared classifier", () => {
  const fixture = createAuthRiskFixture();

  const result = generatePrReview(fixture, { base: "main" });
  const authFile = result.data.changedFiles.find((file) => file.path === "src/auth/token.service.ts");

  assert.ok(authFile);
  assert.ok(authFile.riskFlags.includes("auth/security"), `token.service.ts should be auth/security, got ${authFile.riskFlags.join(", ")}`);
});

// --- Finding #7: raw package.json scripts map is dropped from the payload ---

test("generatePrReview omits the raw package.json scripts map from the result payload", () => {
  const fixture = createSubstringRiskFixture();

  const result = generatePrReview(fixture, { base: "main" });
  assert.equal(result.data.repo.scripts, undefined, "raw scripts map must not be embedded in the payload");
  // testHints still carries the relevant commands derived from those scripts.
  assert.ok(Array.isArray(result.data.testHints));
  assert.ok(
    result.data.testHints.some((hint) => hint.command === "npm test" || hint.command === "npm run lint"),
    `expected derived test hints, got ${JSON.stringify(result.data.testHints)}`,
  );
});

function createSubstringRiskFixture() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-pr-tokens-"));
  fs.mkdirSync(path.join(fixture, "src", "lib"), { recursive: true });
  fs.writeFileSync(
    path.join(fixture, "package.json"),
    JSON.stringify({ scripts: { lint: "eslint .", test: "node --test", build: "tsc", deploy: "echo deploy" } }),
  );
  fs.writeFileSync(
    path.join(fixture, "src", "lib", "tokens.js"),
    ["export function estimateTokens(text) {", "  return Math.ceil(String(text).length / 4);", "}", ""].join("\n"),
  );

  git(fixture, "init", "-b", "main");
  git(fixture, "add", ".");
  git(fixture, "-c", "user.name=Test User", "-c", "user.email=test@example.com", "commit", "-m", "base");
  git(fixture, "checkout", "-b", "feature/tokens");
  fs.appendFileSync(path.join(fixture, "src", "lib", "tokens.js"), ["", "export const TOKENS_VERSION = 2;", ""].join("\n"));
  git(fixture, "add", ".");
  git(fixture, "-c", "user.name=Test User", "-c", "user.email=test@example.com", "commit", "-m", "bump tokens util");
  return fixture;
}

function createAuthRiskFixture() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-pr-auth-"));
  fs.mkdirSync(path.join(fixture, "src", "auth"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  fs.writeFileSync(
    path.join(fixture, "src", "auth", "token.service.ts"),
    ["export class TokenService {", "  sign(payload) { return payload; }", "}", ""].join("\n"),
  );

  git(fixture, "init", "-b", "main");
  git(fixture, "add", ".");
  git(fixture, "-c", "user.name=Test User", "-c", "user.email=test@example.com", "commit", "-m", "base");
  git(fixture, "checkout", "-b", "feature/token");
  fs.appendFileSync(path.join(fixture, "src", "auth", "token.service.ts"), ["", "export const TOKEN_TTL = 3600;", ""].join("\n"));
  git(fixture, "add", ".");
  git(fixture, "-c", "user.name=Test User", "-c", "user.email=test@example.com", "commit", "-m", "change token service");
  return fixture;
}

function createPrFixture() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-pr-"));
  fs.mkdirSync(path.join(fixture, "src", "booking"), { recursive: true });
  fs.writeFileSync(
    path.join(fixture, "package.json"),
    JSON.stringify({
      scripts: {
        lint: "eslint .",
        test: "node --test",
      },
    }),
  );
  fs.writeFileSync(
    path.join(fixture, "src", "booking", "booking.controller.ts"),
    [
      "import { Controller, Get } from '@nestjs/common';",
      "",
      "@Controller('booking')",
      "export class BookingController {",
      "  @Get('/')",
      "  list() {",
      "    return [];",
      "  }",
      "}",
      "",
    ].join("\n"),
  );

  git(fixture, "init", "-b", "main");
  git(fixture, "add", ".");
  git(fixture, "-c", "user.name=Test User", "-c", "user.email=test@example.com", "commit", "-m", "base");
  git(fixture, "checkout", "-b", "feature/booking");
  fs.appendFileSync(path.join(fixture, "src", "booking", "booking.controller.ts"), ["", "export const bookingReviewEnabled = true;", ""].join("\n"));
  git(fixture, "add", ".");
  git(fixture, "-c", "user.name=Test User", "-c", "user.email=test@example.com", "commit", "-m", "change booking controller");
  return fixture;
}

function createGoPrFixture() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-pr-go-"));
  fs.mkdirSync(path.join(fixture, "internal", "githubpr"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "go.mod"), "module example.com/pullpass\n\ngo 1.22\n");
  fs.writeFileSync(
    path.join(fixture, "internal", "githubpr", "evaluate.go"),
    ["package githubpr", "", "type Report struct{}", "", "func Evaluate() Report {", "  return Report{}", "}", ""].join("\n"),
  );

  git(fixture, "init", "-b", "main");
  git(fixture, "add", ".");
  git(fixture, "-c", "user.name=Test User", "-c", "user.email=test@example.com", "commit", "-m", "base");
  git(fixture, "checkout", "-b", "feature/go-review");
  fs.appendFileSync(path.join(fixture, "internal", "githubpr", "evaluate.go"), ["", "func Ready() bool {", "  return true", "}", ""].join("\n"));
  fs.writeFileSync(
    path.join(fixture, "internal", "githubpr", "evaluate_test.go"),
    ["package githubpr", "", 'import "testing"', "", "func TestReady(t *testing.T) {", "  if !Ready() {", '    t.Fatal("not ready")', "  }", "}", ""].join(
      "\n",
    ),
  );
  git(fixture, "add", ".");
  git(fixture, "-c", "user.name=Test User", "-c", "user.email=test@example.com", "commit", "-m", "change Go evaluator");
  return fixture;
}

function createDeletedGoTestFixture() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-pr-go-deleted-"));
  fs.mkdirSync(path.join(fixture, "internal", "githubpr"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "go.mod"), "module example.com/pullpass\n\ngo 1.22\n");
  fs.writeFileSync(path.join(fixture, "internal", "githubpr", "evaluate.go"), "package githubpr\n");
  fs.writeFileSync(
    path.join(fixture, "internal", "githubpr", "obsolete_test.go"),
    'package githubpr\n\nimport "testing"\n\nfunc TestObsolete(t *testing.T) {}\n',
  );

  git(fixture, "init", "-b", "main");
  git(fixture, "add", ".");
  git(fixture, "-c", "user.name=Test User", "-c", "user.email=test@example.com", "commit", "-m", "base");
  git(fixture, "checkout", "-b", "feature/delete-go-test");
  fs.unlinkSync(path.join(fixture, "internal", "githubpr", "obsolete_test.go"));
  git(fixture, "add", ".");
  git(fixture, "-c", "user.name=Test User", "-c", "user.email=test@example.com", "commit", "-m", "delete obsolete test");
  return fixture;
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
