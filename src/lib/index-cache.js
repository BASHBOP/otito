/// <reference types="node" />
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateCodeMap } from "./code-map.js";
import { listRepoFiles } from "./repo.js";

/**
 * A single declaration extracted from a source file.
 * @typedef {object} CodeMapSymbol
 * @property {string} type - Declaration kind ("class", "function", "method", "const", "interface", "type", "enum", "let", "var").
 * @property {string} name
 * @property {number} line - 1-based line number of the declaration.
 * @property {string[]} [terms] - Bounded semantic identifiers within the declaration.
 */

/**
 * An HTTP method/path pair inferred from a controller or route file.
 * @typedef {object} CodeMapHttpMethod
 * @property {string} method
 * @property {string} path
 */

/**
 * A data-access hit (e.g. ORM call) detected in a file.
 * @typedef {object} CodeMapDataAccess
 * @property {string} [kind]
 * @property {string} [name]
 * @property {number} [line]
 */

/**
 * One source file's facts as produced by generateCodeMap.
 * @typedef {object} CodeMapFile
 * @property {string} path - Repo-relative path.
 * @property {string} kind - Classified file kind ("route", "controller", "service", etc.).
 * @property {string} domain - Primary inferred domain.
 * @property {string[]} [domains] - All inferred domains.
 * @property {string|null} [route] - Inferred framework route, if any.
 * @property {string|null} [controllerBasePath] - Inferred controller base path, if any.
 * @property {CodeMapHttpMethod[]} [httpMethods]
 * @property {string[]} imports - Imported module specifiers.
 * @property {string[]} exports - Exported symbol names.
 * @property {CodeMapSymbol[]} symbols
 * @property {string[]} [formFields] - Form control identifiers used by the file.
 * @property {string[]} [navigationTargets] - Static navigation route targets used by the file.
 * @property {string[]} [localIdentifiers] - Local semantic identifier names used by the file.
 * @property {boolean} [isVendor]
 * @property {CodeMapDataAccess[]} [dataAccess]
 */

/**
 * Package metadata captured from package.json.
 * @typedef {object} CodeMapPackage
 * @property {string} [name]
 * @property {string} [version]
 * @property {string} [type]
 * @property {boolean} [private]
 */

/**
 * Repository-level metadata in a code map.
 * @typedef {object} CodeMapRepo
 * @property {string} root
 * @property {string} name
 * @property {CodeMapPackage} [package]
 * @property {object} [git]
 * @property {number} [fileCount]
 * @property {number} [sourceFileCount]
 * @property {Record<string, number>|object} [languages]
 * @property {string[]} [entrypoints]
 */

/**
 * Aggregate counts across all source files.
 * @typedef {object} CodeMapSummary
 * @property {number} routes
 * @property {number} apiRoutes
 * @property {number} controllers
 * @property {number} services
 * @property {number} modules
 * @property {number} components
 * @property {number} hooks
 * @property {number} apiClients
 * @property {number} dtos
 * @property {number} schemas
 * @property {number} tests
 * @property {number} symbols
 * @property {number} dataAccessFiles
 * @property {number} dataAccessHits
 */

/**
 * A domain rollup in a code map.
 * @typedef {object} CodeMapDomain
 * @property {string} name
 * @property {number} fileCount
 * @property {{ kind: string, count: number }[]} kinds
 */

/**
 * Cache provenance attached to a served code map.
 * @typedef {object} CodeMapCacheInfo
 * @property {boolean} hit
 * @property {string} source - "memo" | "disk" | "generated".
 * @property {string} path
 * @property {string} [generatedAt]
 * @property {string} fingerprint
 */

/**
 * The canonical code map shape produced by generateCodeMap and served (with a
 * `cache` field) by getCachedCodeMap. This is the shape consumed across the
 * retrieval/scoring engines; reference it elsewhere with
 * {import('./index-cache.js').CodeMap}.
 * @typedef {object} CodeMap
 * @property {boolean} ok
 * @property {CodeMapRepo} repo
 * @property {CodeMapSummary} summary
 * @property {CodeMapDomain[]} domains
 * @property {CodeMapFile[]} files
 * @property {object} [tokenEstimate]
 * @property {CodeMapCacheInfo} [cache]
 */

const cacheVersion = 10;
const externalCacheDirectory = "otito-index-cache";

// Bound on the in-process memo. MCP hosts call repo-map tools repeatedly for the
// same repo; without this we re-read and re-JSON.parse the on-disk index every call.
const memoLimit = 8;

/**
 * In-process memo of generated code maps, keyed by `${root}\0${fingerprint}`.
 * Insertion order doubles as recency: on hit we re-insert to mark the entry as
 * most-recently-used, and we evict the oldest key once the map exceeds memoLimit.
 * @type {Map<string, object>}
 */
const memo = new Map();

// Paths we have already warned about, so a persistent permission problem emits a
// single line to stderr per process instead of one per tool call.
/** @type {Set<string>} */
const warnedPaths = new Set();

/**
 * Returns the code map for a repository, served from an in-process memo or an
 * external on-disk index when the repo fingerprint is unchanged, regenerating
 * otherwise. The inspected repository is never modified.
 * @param {string} [repoPath]
 */
export function getCachedCodeMap(repoPath = ".") {
  const root = path.resolve(repoPath);
  const cachePath = getCodeMapCachePath(root);
  const fingerprint = repoFingerprint(root);
  const memoKey = `${root}\0${fingerprint}`;

  const memoized = readMemo(memoKey);
  if (memoized) {
    return {
      ...memoized.map,
      cache: {
        hit: true,
        source: "memo",
        path: cachePath,
        generatedAt: memoized.generatedAt,
        fingerprint,
      },
    };
  }

  const cached = readCache(cachePath);
  if (cached?.version === cacheVersion && cached.fingerprint === fingerprint && cached.map?.repo?.root === root) {
    writeMemo(memoKey, { map: cached.map, generatedAt: cached.generatedAt });
    return {
      ...cached.map,
      cache: {
        hit: true,
        source: "disk",
        path: cachePath,
        generatedAt: cached.generatedAt,
        fingerprint,
      },
    };
  }

  const map = generateCodeMap(root);
  const generatedAt = new Date().toISOString();
  writeCache(cachePath, {
    version: cacheVersion,
    generatedAt,
    fingerprint,
    map,
  });
  writeMemo(memoKey, { map, generatedAt });

  return {
    ...map,
    cache: {
      hit: false,
      source: "generated",
      path: cachePath,
      fingerprint,
    },
  };
}

/**
 * Resolve the per-user cache location for a repository without writing into the
 * inspected working tree. The root hash keeps unrelated repositories isolated;
 * the stored map must still name the same root before it is trusted.
 * @param {string} [repoPath]
 */
export function getCodeMapCachePath(repoPath = ".") {
  const root = path.resolve(repoPath);
  return path.join(os.tmpdir(), externalCacheDirectory, hash(root), "index.json");
}

/**
 * @param {string} key
 * @returns {{ map: object, generatedAt: string } | undefined}
 */
function readMemo(key) {
  const entry = memo.get(key);
  if (!entry) {
    return undefined;
  }
  // Re-insert to mark this key as most-recently-used.
  memo.delete(key);
  memo.set(key, entry);
  return /** @type {{ map: object, generatedAt: string }} */ (entry);
}

/**
 * @param {string} key
 * @param {{ map: object, generatedAt: string }} entry
 */
function writeMemo(key, entry) {
  memo.delete(key);
  memo.set(key, entry);
  while (memo.size > memoLimit) {
    const oldest = memo.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    memo.delete(oldest);
  }
}

/**
 * @param {string} root
 */
function repoFingerprint(root) {
  const files = listRepoFiles(root);
  let totalSize = 0;
  let newestMtime = 0;
  const parts = [];
  for (const file of files) {
    try {
      const stats = fs.statSync(path.join(root, file));
      totalSize += stats.size;
      newestMtime = Math.max(newestMtime, Math.floor(stats.mtimeMs));
      parts.push(`${file}:${stats.size}:${Math.floor(stats.mtimeMs)}`);
    } catch {
      // Ignore files that disappeared while building the fingerprint.
    }
  }
  return `${files.length}:${totalSize}:${newestMtime}:${hash(parts.join("|"))}`;
}

/**
 * @param {string} cachePath
 */
function readCache(cachePath) {
  try {
    return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Writes the cache atomically: serialize to a sibling temp file, then rename over
 * the target. Rename is atomic on POSIX within a filesystem, so readers never see
 * a half-written index even if the process dies mid-write.
 * @param {string} cachePath
 * @param {object} value
 */
function writeCache(cachePath, value) {
  const dir = path.dirname(cachePath);
  const tempPath = path.join(dir, `.index.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
    fs.renameSync(tempPath, cachePath);
  } catch (error) {
    // Cache writes should not break MCP tool calls, but a silently swallowed
    // failure makes permission problems undiagnosable. Warn once per path.
    warnWriteFailureOnce(cachePath, error);
    // Best-effort cleanup so a failed rename does not leave a stray temp file.
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Nothing more we can do; the temp file is already orphaned.
    }
  }
}

/**
 * @param {string} cachePath
 * @param {unknown} error
 */
function warnWriteFailureOnce(cachePath, error) {
  if (warnedPaths.has(cachePath)) {
    return;
  }
  warnedPaths.add(cachePath);
  const reason = error instanceof Error ? error.message : String(error);
  console.warn(`otito: could not write repo index cache at ${cachePath}: ${reason}`);
}

/**
 * @param {string} value
 */
function hash(value) {
  let result = 5381;
  for (let index = 0; index < value.length; index += 1) {
    result = ((result << 5) + result) ^ value.charCodeAt(index);
  }
  return (result >>> 0).toString(16);
}
