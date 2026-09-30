import test from "node:test";
import assert from "node:assert/strict";
import { syncPinnedDocVersion, findPinnedDocVersionDrift, findWhatsNewDrift } from "../src/lib/version-docs.js";

const WHATS_NEW = `
## What's New

!!! tip "v1.9.2 published (2026-09-07)"
    - solumbe is now listed on mcpservers.org.

    [npm v1.9.2](https://www.npmjs.com/package/@bashbop/solumbe/v/1.9.2) · [GitHub Release](https://github.com/BASHBOP/solumbe/releases/tag/v1.9.2)
`;

function indexFixture(version) {
  return `**Status:** v${version} published to npm, GitHub Releases, and the official MCP Registry<br>
${WHATS_NEW}
\`\`\`bash
npm install -g @bashbop/solumbe@${version}
solumbe doctor
\`\`\`

\`\`\`bash
npx -y @bashbop/solumbe@${version} doctor
\`\`\`
`;
}

test("syncPinnedDocVersion rewrites the install/npx commands and Status line", () => {
  const { content, changed } = syncPinnedDocVersion(indexFixture("1.9.2"), "1.9.3");
  assert.equal(changed, true);
  assert.match(content, /\*\*Status:\*\* v1\.9\.3/);
  assert.match(content, /npm install -g @bashbop\/solumbe@1\.9\.3/);
  assert.match(content, /npx -y @bashbop\/solumbe@1\.9\.3 doctor/);
});

test("syncPinnedDocVersion leaves the What's New section's historical links untouched", () => {
  const { content } = syncPinnedDocVersion(indexFixture("1.9.2"), "1.9.3");
  assert.match(content, /v1\.9\.2 published \(2026-09-07\)/);
  assert.match(content, /package\/@bashbop\/solumbe\/v\/1\.9\.2/);
  assert.match(content, /releases\/tag\/v1\.9\.2/);
});

test("syncPinnedDocVersion is a no-op when already in sync", () => {
  const { content, changed } = syncPinnedDocVersion(indexFixture("1.9.2"), "1.9.2");
  assert.equal(changed, false);
  assert.equal(content, indexFixture("1.9.2"));
});

test("syncPinnedDocVersion handles a doc with only the pinned install command (RELEASE.md shape)", () => {
  const release = "Verify the published binary:\n\n```bash\nnpm install -g @bashbop/solumbe@1.0.2\nsolumbe doctor\n```\n";
  const { content, changed } = syncPinnedDocVersion(release, "1.9.2");
  assert.equal(changed, true);
  assert.match(content, /npm install -g @bashbop\/solumbe@1\.9\.2/);
});

test("findPinnedDocVersionDrift reports nothing when versions match", () => {
  const issues = findPinnedDocVersionDrift(indexFixture("1.9.2"), "1.9.2");
  assert.deepEqual(issues, []);
});

test("findPinnedDocVersionDrift flags a stale pinned install command", () => {
  const issues = findPinnedDocVersionDrift(indexFixture("1.0.2"), "1.9.2");
  assert.ok(issues.some((issue) => issue.includes("npm install -g @bashbop/solumbe@1.0.2")));
  assert.ok(issues.some((issue) => issue.includes("npx -y @bashbop/solumbe@1.0.2")));
});

test("findPinnedDocVersionDrift flags a stale Status line", () => {
  const issues = findPinnedDocVersionDrift(indexFixture("1.9.1"), "1.9.2");
  assert.ok(issues.some((issue) => issue.includes("Status line says v1.9.1")));
});

test("findPinnedDocVersionDrift ignores docs with no pinned version markers", () => {
  const issues = findPinnedDocVersionDrift("# Just prose, no pins here.", "1.9.2");
  assert.deepEqual(issues, []);
});

// docs/index.md replaced the "**Status:** v" line with this banner, and the
// 3.3.0 release shipped with the site still announcing v3.2.0.
function bannerIndexFixture(bannerVersion, whatsNewVersions) {
  const entries = whatsNewVersions.map((v) => `!!! tip "v${v} published (2026-09-27)"\n    - notes\n`).join("\n");
  return `**v${bannerVersion}** is published to npm, GitHub Releases, and the official MCP Registry.

## What's New

${entries}`;
}

test("syncPinnedDocVersion rewrites the published banner", () => {
  const { content, changed } = syncPinnedDocVersion(bannerIndexFixture("3.2.0", ["3.2.0"]), "3.3.0");
  assert.equal(changed, true);
  assert.match(content, /^\*\*v3\.3\.0\*\* is published/);
  assert.match(content, /v3\.2\.0 published \(2026-09-27\)/, "What's New history is untouched");
});

test("findPinnedDocVersionDrift reports a stale published banner", () => {
  assert.deepEqual(findPinnedDocVersionDrift(bannerIndexFixture("3.2.0", ["3.3.0"]), "3.3.0"), [
    "published banner says v3.2.0 but package.json version is 3.3.0",
  ]);
  assert.deepEqual(findPinnedDocVersionDrift(bannerIndexFixture("3.3.0", ["3.3.0"]), "3.3.0"), []);
});

test("findWhatsNewDrift reports a release with no What's New entry", () => {
  assert.deepEqual(findWhatsNewDrift(bannerIndexFixture("3.3.0", ["3.2.0", "3.1.0"]), "3.3.0"), [
    'What\'s New has no "v3.3.0 published" entry for the current package.json version',
  ]);
  assert.deepEqual(findWhatsNewDrift(bannerIndexFixture("3.3.0", ["3.3.0", "3.2.0"]), "3.3.0"), []);
});

test("findWhatsNewDrift does not accept a different version that shares a prefix", () => {
  assert.equal(findWhatsNewDrift(bannerIndexFixture("3.3.0", ["3.3.01"]), "3.3.0").length, 1);
  assert.equal(findWhatsNewDrift(bannerIndexFixture("3.3.0", ["3.3.0-rc.1"]), "3.3.0").length, 1);
});

test("findWhatsNewDrift ignores docs without a What's New section", () => {
  assert.deepEqual(findWhatsNewDrift("npm install -g @bashbop/solumbe@3.3.0\n", "3.3.0"), []);
});
