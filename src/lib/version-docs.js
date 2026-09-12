// Pure helpers for the release-time doc/version sync and its drift check.
// Shared by scripts/sync-server-version.mjs (writes) and
// scripts/check-version.js (verifies), and unit-tested independently of
// the filesystem so the regexes stay correct without a real repo checkout.

const VERSIONED_COMMAND = /(npm install -g @bashbop\/otito@|npx -y @bashbop\/otito@)(\d+\.\d+\.\d+)/g;
const STATUS_LINE = /(\*\*Status:\*\* v)(\d+\.\d+\.\d+)/;

// Rewrites pinned `@bashbop/otito@X.Y.Z` install/verify commands and the
// docs "Status" line to the current release. Deliberately does not touch
// docs/index.md's "What's New" section (a per-release changelog entry with
// its own historical npm/GitHub-release links) since neither pattern
// appears there.
/**
 * @param {string} content
 * @param {string} version
 * @returns {{ content: string, changed: boolean }}
 */
export function syncPinnedDocVersion(content, version) {
  const updated = content.replace(VERSIONED_COMMAND, `$1${version}`).replace(STATUS_LINE, `$1${version}`);
  return { content: updated, changed: updated !== content };
}

// Returns a list of human-readable drift messages (empty when in sync).
/**
 * @param {string} content
 * @param {string} expectedVersion
 * @returns {string[]}
 */
export function findPinnedDocVersionDrift(content, expectedVersion) {
  const issues = [];

  for (const match of content.matchAll(VERSIONED_COMMAND)) {
    if (match[2] !== expectedVersion) {
      issues.push(`pins "${match[0]}" but package.json version is ${expectedVersion}`);
    }
  }

  const statusMatch = content.match(STATUS_LINE);
  if (statusMatch && statusMatch[2] !== expectedVersion) {
    issues.push(`Status line says v${statusMatch[2]} but package.json version is ${expectedVersion}`);
  }

  return issues;
}
