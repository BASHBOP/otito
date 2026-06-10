import fs from "node:fs";
import path from "node:path";
import { generateCodeMap } from "./code-map.js";
import { listRepoFiles } from "./repo.js";

const cacheVersion = 4;

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
 * on-disk index when the repo fingerprint is unchanged, regenerating otherwise.
 * @param {string} [repoPath]
 */
export function getCachedCodeMap(repoPath = ".") {
  const root = path.resolve(repoPath);
  const cachePath = path.join(root, ".dev-context", "index.json");
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
  if (cached?.version === cacheVersion && cached.fingerprint === fingerprint && cached.map) {
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
  console.warn(`repoctx: could not write repo index cache at ${cachePath}: ${reason}`);
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
