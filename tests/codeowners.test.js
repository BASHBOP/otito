import test from "node:test";
import assert from "node:assert/strict";
import { directUserOwners, hasExternalOwner, hasTeamOrExternalOwner, matchFile, ownedFiles, parse, teamOwners } from "../src/lib/codeowners.js";

const ruleset = {
  path: "CODEOWNERS",
  rules: parse(
    [
      "# top-level comment",
      "*       @org/default-team",
      "src/auth/**   @alice @org/security",
      "/scripts/*.sh   @bob",
      "docs/        @org/docs-team",
      "package-lock.json   release-bot@example.com",
    ].join("\n"),
  ),
};

test("parse skips comments and blank lines", () => {
  const rules = parse("\n# only a comment\n\n*  @alice\n# trailing\n");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].pattern, "*");
  assert.deepEqual(rules[0].owners, ["@alice"]);
});

test("matchFile last-rule-wins for overlapping patterns", () => {
  const result = matchFile(ruleset, "src/auth/session.ts");
  assert.deepEqual(result.owners, ["@alice", "@org/security"]);
});

test("matchFile falls back to wildcard rule", () => {
  const result = matchFile(ruleset, "src/utils/format.ts");
  assert.deepEqual(result.owners, ["@org/default-team"]);
});

test("matchFile honours anchored patterns", () => {
  const result = matchFile(ruleset, "scripts/run.sh");
  assert.deepEqual(result.owners, ["@bob"]);
  const nested = matchFile(ruleset, "infra/scripts/run.sh");
  assert.deepEqual(nested.owners, ["@org/default-team"], "anchored /scripts/ should not match nested scripts/");
});

test("matchFile expands directory patterns to /**", () => {
  const result = matchFile(ruleset, "docs/setup/install.md");
  assert.deepEqual(result.owners, ["@org/docs-team"]);
});

test("ownedFiles filters to files with owners", () => {
  const list = ownedFiles(ruleset, ["src/auth/session.ts", "src/utils/format.ts", "package-lock.json"]);
  assert.equal(list.length, 3);
});

test("directUserOwners returns user logins only", () => {
  const result = directUserOwners(["@alice", "@org/security", "release-bot@example.com"]);
  assert.deepEqual(result, ["alice"]);
});

test("teamOwners parses org/slug pairs", () => {
  const result = teamOwners(["@org/security", "@alice", "@bad", "@org/", "@/slug"]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { owner: "@org/security", org: "org", slug: "security" });
});

test("hasExternalOwner detects email mentions", () => {
  assert.equal(hasExternalOwner(["@alice"]), false);
  assert.equal(hasExternalOwner(["release-bot@example.com"]), true);
});

test("hasTeamOrExternalOwner detects teams or externals", () => {
  assert.equal(hasTeamOrExternalOwner(["@alice"]), false);
  assert.equal(hasTeamOrExternalOwner(["@org/security"]), true);
  assert.equal(hasTeamOrExternalOwner(["bot@example.com"]), true);
});
