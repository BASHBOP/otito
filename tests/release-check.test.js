import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkRelease } from "../src/lib/release-check.js";

function fixture(prefix, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `release-${prefix}-`));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

test("checkRelease passes when no version files changed", () => {
  const root = fixture("none", { "package.json": JSON.stringify({ version: "1.0.0" }) });
  const result = checkRelease(root, ["src/index.ts"]);
  assert.equal(result.status, "PASS");
  assert.match(result.summary, /No version metadata changes/);
});

test("checkRelease fails on non-SemVer version", () => {
  const root = fixture("bad-semver", { "package.json": JSON.stringify({ version: "not-a-version" }) });
  const result = checkRelease(root, ["package.json"]);
  assert.equal(result.status, "FAIL");
  assert.match(result.summary, /non-SemVer/);
});

test("checkRelease fails when versions disagree across files", () => {
  const root = fixture("mismatch", {
    "package.json": JSON.stringify({ version: "1.0.0" }),
    "package-lock.json": JSON.stringify({ packages: { "": { version: "1.0.1" } } }),
  });
  const result = checkRelease(root, ["package.json", "package-lock.json"]);
  assert.equal(result.status, "FAIL");
  assert.match(result.summary, /do not agree/);
});

test("checkRelease fails when changelog not updated", () => {
  const root = fixture("no-changelog", { "package.json": JSON.stringify({ version: "1.0.0" }) });
  const result = checkRelease(root, ["package.json"]);
  assert.equal(result.status, "FAIL");
  assert.match(result.summary, /without a changelog/);
});

test("checkRelease passes when version + changelog update together", () => {
  const root = fixture("ok", { "package.json": JSON.stringify({ version: "1.2.3" }) });
  const result = checkRelease(root, ["package.json", "CHANGELOG.md"]);
  assert.equal(result.status, "PASS");
  assert.ok(result.details?.some((line) => line.includes("1.2.3")));
});

test("checkRelease warns when a version file cannot be read", () => {
  const root = fixture("unreadable", {});
  const result = checkRelease(root, ["package.json"]);
  assert.equal(result.status, "WARN");
});
