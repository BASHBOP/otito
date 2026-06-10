import fs from "node:fs";
import path from "node:path";
import { commandExists, runCommand } from "./tools.js";

/**
 * @typedef {object} DependencyMatch
 * @property {string} file
 * @property {number} line
 * @property {string} text
 */

/**
 * @typedef {object} InspectDependencyOptions
 * @property {string} [query] Search query to run against the resolved source tree.
 * @property {number} [limit] Maximum matches to return.
 */

/**
 * @param {string} packageName
 * @param {InspectDependencyOptions} [options]
 * @returns {object}
 */
export function inspectDependency(packageName, options = {}) {
  const installed = commandExists("opensrc");
  if (!installed.available) {
    return {
      ok: false,
      packageName,
      error: "opensrc is not installed.",
      installHint: "Install with: npm install -g opensrc",
    };
  }

  const pathResult = runCommand("opensrc", ["path", packageName], { timeout: 120000 });
  if (!pathResult.ok) {
    return {
      ok: false,
      packageName,
      error: pathResult.stderr.trim() || pathResult.error?.message || "opensrc path failed",
      installHint: "Check package name or opensrc authentication.",
    };
  }

  const sourcePath = pathResult.stdout.trim();
  /** @type {{ ok: boolean, packageName: string, sourcePath: string, query?: string, matches?: DependencyMatch[] }} */
  const result = {
    ok: true,
    packageName,
    sourcePath,
  };

  if (options.query) {
    result.query = options.query;
    result.matches = searchSource(sourcePath, options.query, options.limit ?? 25);
  }

  return result;
}

/**
 * @param {string} sourcePath
 * @param {string} query
 * @param {number} [limit]
 * @returns {DependencyMatch[]}
 */
export function searchSource(sourcePath, query, limit = 25) {
  const rg = commandExists("rg");
  if (rg.available) {
    const result = runCommand("rg", ["--line-number", "--no-heading", "--color", "never", query, sourcePath], {
      timeout: 120000,
    });
    return parseRipgrep(result.stdout, sourcePath).slice(0, limit);
  }

  return fallbackSearch(sourcePath, query, limit);
}

/**
 * @param {string} output
 * @param {string} sourcePath
 * @returns {DependencyMatch[]}
 */
function parseRipgrep(output, sourcePath) {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [file, lineNumber, ...rest] = line.split(":");
      return {
        file: path.relative(sourcePath, file),
        line: Number(lineNumber),
        text: rest.join(":").trim(),
      };
    });
}

/**
 * @param {string} sourcePath
 * @param {string} query
 * @param {number} limit
 * @returns {DependencyMatch[]}
 */
function fallbackSearch(sourcePath, query, limit) {
  /** @type {DependencyMatch[]} */
  const results = [];
  const lowerQuery = query.toLowerCase();
  visit(sourcePath);
  return results;

  /**
   * @param {string} current
   * @returns {void}
   */
  function visit(current) {
    if (results.length >= limit) {
      return;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= limit || ["node_modules", ".git", "dist", "build"].includes(entry.name)) {
        continue;
      }

      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const text = safeRead(absolute);
      if (!text) {
        continue;
      }

      const lines = text.split("\n");
      for (let index = 0; index < lines.length && results.length < limit; index += 1) {
        if (lines[index].toLowerCase().includes(lowerQuery)) {
          results.push({
            file: path.relative(sourcePath, absolute),
            line: index + 1,
            text: lines[index].trim(),
          });
        }
      }
    }
  }
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function safeRead(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size > 1024 * 1024) {
      return "";
    }
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}
