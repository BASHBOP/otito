// Pure helpers for the release-time doc/version sync and its drift check.
// Shared by scripts/sync-server-version.mjs (writes) and
// scripts/check-version.js (verifies), and unit-tested independently of
// the filesystem so the regexes stay correct without a real repo checkout.

const VERSIONED_COMMAND = /(npm install -g @bashbop\/otito@|npx -y @bashbop\/otito@)(\d+\.\d+\.\d+)/g;
const STATUS_LINE = /(\*\*Status:\*\* v)(\d+\.\d+\.\d+)/;
// The landing page's banner, "**v3.3.0** is published to npm, ...". It
// replaced the "**Status:** v" line, and neither the sync nor the drift
// check knew its shape, so the 3.3.0 release shipped with the site still
// announcing v3.2.0.
const PUBLISHED_BANNER = /(\*\*v)(\d+\.\d+\.\d+)(\*\* is published)/;
const WHATS_NEW_HEADING = /^## What's New\s*$/m;

// Rewrites pinned `@bashbop/otito@X.Y.Z` install/verify commands, the
// docs "Status" line and the landing page's published banner to the current
// release. Deliberately does not touch docs/index.md's "What's New" section
// (a per-release changelog entry with its own historical npm/GitHub-release
// links) since none of these patterns appears there.
/**
 * @param {string} content
 * @param {string} version
 * @returns {{ content: string, changed: boolean }}
 */
export function syncPinnedDocVersion(content, version) {
  const updated = content.replace(VERSIONED_COMMAND, `$1${version}`).replace(STATUS_LINE, `$1${version}`).replace(PUBLISHED_BANNER, `$1${version}$3`);
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

  const bannerMatch = content.match(PUBLISHED_BANNER);
  if (bannerMatch && bannerMatch[2] !== expectedVersion) {
    issues.push(`published banner says v${bannerMatch[2]} but package.json version is ${expectedVersion}`);
  }

  return issues;
}

// The "What's New" section is written by hand per release, so the sync
// cannot fill it in; this only reports that the current version has no
// entry. Docs without the section (RELEASE.md) report nothing.
/**
 * @param {string} content
 * @param {string} expectedVersion
 * @returns {string[]}
 */
export function findWhatsNewDrift(content, expectedVersion) {
  if (!WHATS_NEW_HEADING.test(content)) return [];

  const escaped = expectedVersion.replace(/\./g, "\\.");
  const entry = new RegExp(`^!!! \\w+ "v${escaped} published`, "m");
  return entry.test(content) ? [] : [`What's New has no "v${expectedVersion} published" entry for the current package.json version`];
}
