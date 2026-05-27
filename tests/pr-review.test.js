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

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
