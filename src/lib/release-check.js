// Release-discipline check ported from pullpass/internal/release/check.go.
// When version-bearing files change, this verifies SemVer + cross-file
// agreement + that the changelog was bumped. Returns the same check record
// shape as the other pass checks: { name, status, summary, details? }.

import fs from "node:fs";
import path from "node:path";

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const STRING_VERSION_RE = /^\s*version\s*=\s*"([^"]+)"/m;

const VERSION_FILES = new Set(["package.json", "package-lock.json", "npm-shrinkwrap.json", "pyproject.toml", "cargo.toml"]);

const CHANGELOG_PATHS = new Set(["changelog.md", "docs/changelog.md"]);

export const STATUS = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
};

// `options.baseContent(file)` may return the content of a version file at the
// comparison base (or null/undefined when unavailable). When supplied, the
// changelog requirement only applies if the project version actually changed —
// dependency or lockfile bumps that leave the version untouched are not a
// release and must not be blocked.
export function checkRelease(root, files, options = {}) {
  const versionFiles = pickVersionFiles(files);
  if (versionFiles.length === 0) {
    return check("Release discipline", STATUS.pass, "No version metadata changes found.");
  }

  const { values, warnings } = readVersions(root, versionFiles);
  if (warnings.length > 0) {
    return check("Release discipline", STATUS.warn, "Version metadata changed, but some files could not be inspected.", warnings);
  }
  if (values.length === 0) {
    return check("Release discipline", STATUS.warn, "Version metadata changed, but no supported version value was found.", versionFiles);
  }

  const invalid = values.filter((item) => !SEMVER_RE.test(item.version)).map((item) => `${item.source} -> ${item.version}`);
  if (invalid.length > 0) {
    return check("Release discipline", STATUS.fail, "Version metadata contains non-SemVer values.", invalid);
  }

  const mismatches = collectMismatches(values);
  if (mismatches.length > 0) {
    return check("Release discipline", STATUS.fail, "Version metadata files do not agree.", mismatches);
  }

  if (typeof options.baseContent === "function") {
    const baseVersion = readBaseVersion(versionFiles, options.baseContent);
    if (baseVersion !== null && baseVersion === values[0].version) {
      return check(
        "Release discipline",
        STATUS.pass,
        "Version metadata changed but the project version is unchanged (dependency or lockfile update).",
        formatValues(values),
      );
    }
  }

  if (!changedChangelog(files)) {
    return check("Release discipline", STATUS.fail, "Version metadata changed without a changelog update.", versionFiles);
  }

  return check("Release discipline", STATUS.pass, "Version metadata is SemVer and changelog was updated.", formatValues(values));
}

// Resolve the project version at the base ref, preferring the manifest over the
// lockfile. Returns null when no base version can be determined.
function readBaseVersion(versionFiles, baseContent) {
  const priority = ["package.json", "package-lock.json", "npm-shrinkwrap.json", "pyproject.toml", "cargo.toml"];
  const ordered = [...versionFiles].sort((a, b) => priority.indexOf(normalize(a)) - priority.indexOf(normalize(b)));
  for (const file of ordered) {
    let content;
    try {
      content = baseContent(file);
    } catch {
      content = null;
    }
    if (content == null) continue;
    try {
      const parsed = parseVersionFile(file, content);
      if (parsed.length > 0) return parsed[0].version;
    } catch {
      // Unparseable base content — try the next file.
    }
  }
  return null;
}

function pickVersionFiles(files) {
  const seen = new Set();
  const matches = [];
  for (const file of files) {
    const normalized = normalize(file);
    if (VERSION_FILES.has(normalized) && !seen.has(normalized)) {
      seen.add(normalized);
      matches.push(normalized);
    }
  }
  matches.sort();
  return matches;
}

function changedChangelog(files) {
  return files.some((file) => CHANGELOG_PATHS.has(normalize(file)));
}

function readVersions(root, files) {
  const values = [];
  const warnings = [];
  for (const file of files) {
    const absolute = path.join(root, file);
    let data;
    try {
      data = fs.readFileSync(absolute, "utf8");
    } catch (error) {
      warnings.push(`${file} -> ${error.message ?? String(error)}`);
      continue;
    }
    try {
      const parsed = parseVersionFile(file, data);
      values.push(...parsed);
    } catch (error) {
      warnings.push(`${file} -> ${error.message ?? String(error)}`);
    }
  }
  return { values, warnings };
}

function parseVersionFile(file, data) {
  switch (normalize(file)) {
    case "package.json": {
      const version = parseJsonVersion(data);
      return version ? [{ source: file, version }] : [];
    }
    case "package-lock.json":
    case "npm-shrinkwrap.json": {
      const version = parseLockVersion(data);
      return version ? [{ source: file, version }] : [];
    }
    case "pyproject.toml":
    case "cargo.toml": {
      const match = data.match(STRING_VERSION_RE);
      return match ? [{ source: file, version: match[1] }] : [];
    }
    default:
      return [];
  }
}

function parseJsonVersion(data) {
  const parsed = JSON.parse(data);
  const version = String(parsed?.version ?? "").trim();
  if (!version) throw new Error("version is empty");
  return version;
}

function parseLockVersion(data) {
  const parsed = JSON.parse(data);
  const rootEntry = parsed?.packages?.[""];
  const rootVersion = String(rootEntry?.version ?? "").trim();
  if (rootVersion) return rootVersion;
  const topVersion = String(parsed?.version ?? "").trim();
  if (!topVersion) throw new Error("version is empty");
  return topVersion;
}

function collectMismatches(values) {
  if (values.length < 2) return [];
  const expected = values[0].version;
  const mismatches = new Set();
  for (let i = 1; i < values.length; i += 1) {
    if (values[i].version !== expected) {
      mismatches.add(`${values[0].source} -> ${expected}`);
      mismatches.add(`${values[i].source} -> ${values[i].version}`);
    }
  }
  return [...mismatches];
}

function formatValues(values) {
  return [...new Set(values.map((item) => `${item.source} -> ${item.version}`))].sort();
}

function normalize(filePath) {
  return String(filePath ?? "")
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function check(name, status, summary, details) {
  if (details && details.length > 0) {
    return { name, status, summary, details };
  }
  return { name, status, summary };
}
