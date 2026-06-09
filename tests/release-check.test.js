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

test("checkRelease downgrades missing changelog to WARN for a private package under solo governance", () => {
  const root = fixture("private-solo", { "package.json": JSON.stringify({ version: "1.0.0", private: true }) });
  const result = checkRelease(root, ["package.json"], { governance: "solo" });
  assert.equal(result.status, "WARN");
  assert.match(result.summary, /without a changelog update \(private package, solo governance\)/);
});

test("checkRelease keeps missing changelog FAIL for a private package under team governance", () => {
  const root = fixture("private-team", { "package.json": JSON.stringify({ version: "1.0.0", private: true }) });
  const result = checkRelease(root, ["package.json"], { governance: "team" });
  assert.equal(result.status, "FAIL");
  assert.match(result.summary, /without a changelog/);
});

test("checkRelease keeps missing changelog FAIL for a public package under solo governance", () => {
  const root = fixture("public-solo", { "package.json": JSON.stringify({ version: "1.0.0" }) });
  const result = checkRelease(root, ["package.json"], { governance: "solo" });
  assert.equal(result.status, "FAIL");
  assert.match(result.summary, /without a changelog/);
});

test("checkRelease keeps version-file mismatch FAIL even for a private package under solo governance", () => {
  const root = fixture("mismatch-private-solo", {
    "package.json": JSON.stringify({ version: "1.0.0", private: true }),
    "package-lock.json": JSON.stringify({ packages: { "": { version: "1.0.1" } } }),
  });
  const result = checkRelease(root, ["package.json", "package-lock.json"], { governance: "solo" });
  assert.equal(result.status, "FAIL");
  assert.match(result.summary, /do not agree/);
});

test("checkRelease passes a dependency bump that leaves the project version unchanged", () => {
  const root = fixture("dep-bump", {
    "package.json": JSON.stringify({ version: "1.3.2", devDependencies: { eslint: "10.4.1" } }),
    "package-lock.json": JSON.stringify({ version: "1.3.2", packages: { "": { version: "1.3.2" } } }),
  });
  const baseContent = (file) => {
    if (file === "package.json") return JSON.stringify({ version: "1.3.2", devDependencies: { eslint: "10.4.0" } });
    if (file === "package-lock.json") return JSON.stringify({ version: "1.3.2", packages: { "": { version: "1.3.2" } } });
    return null;
  };
  const result = checkRelease(root, ["package.json", "package-lock.json"], { baseContent });
  assert.equal(result.status, "PASS");
  assert.match(result.summary, /project version is unchanged/);
});

test("checkRelease still fails a real version bump with no changelog even with baseContent", () => {
  const root = fixture("real-bump", { "package.json": JSON.stringify({ version: "1.3.3" }) });
  const baseContent = (file) => (file === "package.json" ? JSON.stringify({ version: "1.3.2" }) : null);
  const result = checkRelease(root, ["package.json"], { baseContent });
  assert.equal(result.status, "FAIL");
  assert.match(result.summary, /without a changelog/);
});
