import fs from "node:fs";
import path from "node:path";
import { generateCodeMap } from "./code-map.js";
import { listRepoFiles } from "./repo.js";

const cacheVersion = 2;

export function getCachedCodeMap(repoPath = ".") {
  const root = path.resolve(repoPath);
  const cachePath = path.join(root, ".dev-context", "index.json");
  const fingerprint = repoFingerprint(root);
  const cached = readCache(cachePath);

  if (cached?.version === cacheVersion && cached.fingerprint === fingerprint && cached.map) {
    return {
      ...cached.map,
      cache: {
        hit: true,
        path: cachePath,
        generatedAt: cached.generatedAt,
        fingerprint,
      },
    };
  }

  const map = generateCodeMap(root);
  writeCache(cachePath, {
    version: cacheVersion,
    generatedAt: new Date().toISOString(),
    fingerprint,
    map,
  });

  return {
    ...map,
    cache: {
      hit: false,
      path: cachePath,
      fingerprint,
    },
  };
}

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

function readCache(cachePath) {
  try {
    return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  } catch {
    return undefined;
  }
}

function writeCache(cachePath, value) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(value, null, 2));
  } catch {
    // Cache writes should not break MCP tool calls.
  }
}

function hash(value) {
  let result = 5381;
  for (let index = 0; index < value.length; index += 1) {
    result = ((result << 5) + result) ^ value.charCodeAt(index);
  }
  return (result >>> 0).toString(16);
}
