import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generatePrReview } from "../src/lib/pr-review.js";

test("generatePrReview summarizes branch diff with risk and test hints", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-pr-"));
  fs.mkdirSync(path.join(fixture, "src", "booking"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({
    scripts: {
      lint: "eslint .",
      test: "node --test"
    }
  }));
  fs.writeFileSync(path.join(fixture, "src", "booking", "booking.controller.ts"), [
    "import { Controller, Get } from '@nestjs/common';",
    "",
    "@Controller('booking')",
    "export class BookingController {",
    "  @Get('/')",
    "  list() {",
    "    return [];",
    "  }",
    "}",
    ""
  ].join("\n"));

  git(fixture, "init", "-b", "main");
  git(fixture, "add", ".");
  git(fixture, "-c", "user.name=Test User", "-c", "user.email=test@example.com", "commit", "-m", "base");
  git(fixture, "checkout", "-b", "feature/booking");
  fs.appendFileSync(path.join(fixture, "src", "booking", "booking.controller.ts"), [
    "",
    "export const bookingReviewEnabled = true;",
    ""
  ].join("\n"));
  git(fixture, "add", ".");
  git(fixture, "-c", "user.name=Test User", "-c", "user.email=test@example.com", "commit", "-m", "change booking controller");

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
});

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
