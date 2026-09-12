import test from "node:test";
import assert from "node:assert/strict";
import { syncPinnedDocVersion, findPinnedDocVersionDrift } from "../src/lib/version-docs.js";

const WHATS_NEW = `
## What's New

!!! tip "v1.9.2 published (2026-09-07)"
    - otito is now listed on mcpservers.org.

    [npm v1.9.2](https://www.npmjs.com/package/@bashbop/otito/v/1.9.2) · [GitHub Release](https://github.com/BASHBOP/otito/releases/tag/v1.9.2)
`;

function indexFixture(version) {
  return `**Status:** v${version} published to npm, GitHub Releases, and the official MCP Registry<br>
${WHATS_NEW}
\`\`\`bash
npm install -g @bashbop/otito@${version}
otito doctor
\`\`\`

\`\`\`bash
npx -y @bashbop/otito@${version} doctor
\`\`\`
`;
}

test("syncPinnedDocVersion rewrites the install/npx commands and Status line", () => {
  const { content, changed } = syncPinnedDocVersion(indexFixture("1.9.2"), "1.9.3");
  assert.equal(changed, true);
  assert.match(content, /\*\*Status:\*\* v1\.9\.3/);
  assert.match(content, /npm install -g @bashbop\/otito@1\.9\.3/);
  assert.match(content, /npx -y @bashbop\/otito@1\.9\.3 doctor/);
});

test("syncPinnedDocVersion leaves the What's New section's historical links untouched", () => {
  const { content } = syncPinnedDocVersion(indexFixture("1.9.2"), "1.9.3");
  assert.match(content, /v1\.9\.2 published \(2026-09-07\)/);
  assert.match(content, /package\/@bashbop\/otito\/v\/1\.9\.2/);
  assert.match(content, /releases\/tag\/v1\.9\.2/);
});

test("syncPinnedDocVersion is a no-op when already in sync", () => {
  const { content, changed } = syncPinnedDocVersion(indexFixture("1.9.2"), "1.9.2");
  assert.equal(changed, false);
  assert.equal(content, indexFixture("1.9.2"));
});

test("syncPinnedDocVersion handles a doc with only the pinned install command (RELEASE.md shape)", () => {
  const release = "Verify the published binary:\n\n```bash\nnpm install -g @bashbop/otito@1.0.2\notito doctor\n```\n";
  const { content, changed } = syncPinnedDocVersion(release, "1.9.2");
  assert.equal(changed, true);
  assert.match(content, /npm install -g @bashbop\/otito@1\.9\.2/);
});

test("findPinnedDocVersionDrift reports nothing when versions match", () => {
  const issues = findPinnedDocVersionDrift(indexFixture("1.9.2"), "1.9.2");
  assert.deepEqual(issues, []);
});

test("findPinnedDocVersionDrift flags a stale pinned install command", () => {
  const issues = findPinnedDocVersionDrift(indexFixture("1.0.2"), "1.9.2");
  assert.ok(issues.some((issue) => issue.includes("npm install -g @bashbop/otito@1.0.2")));
  assert.ok(issues.some((issue) => issue.includes("npx -y @bashbop/otito@1.0.2")));
});

test("findPinnedDocVersionDrift flags a stale Status line", () => {
  const issues = findPinnedDocVersionDrift(indexFixture("1.9.1"), "1.9.2");
  assert.ok(issues.some((issue) => issue.includes("Status line says v1.9.1")));
});

test("findPinnedDocVersionDrift ignores docs with no pinned version markers", () => {
  const issues = findPinnedDocVersionDrift("# Just prose, no pins here.", "1.9.2");
  assert.deepEqual(issues, []);
});
