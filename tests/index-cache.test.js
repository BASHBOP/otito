import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getCachedCodeMap } from "../src/lib/index-cache.js";

function makeRepo(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), name));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "cached-repo" }));
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export const ok = true;\n");
  return root;
}

const cachePathFor = (root) => path.join(root, ".dev-context", "index.json");

test("getCachedCodeMap writes and reuses a repo index", () => {
  const root = makeRepo("dev-context-index-");

  const first = getCachedCodeMap(root);
  const second = getCachedCodeMap(root);

  assert.equal(first.cache.hit, false);
  assert.equal(second.cache.hit, true);
  assert.equal(second.repo.name, "cached-repo");
  assert.ok(fs.existsSync(cachePathFor(root)));
});

test("regenerates when a file changes (fingerprint staleness)", () => {
  const root = makeRepo("dev-context-index-stale-");

  const first = getCachedCodeMap(root);
  assert.equal(first.cache.hit, false);

  // Change file content (and length, so the fingerprint moves regardless of
  // mtime resolution). A new fingerprint means a new memo key, so this also
  // exercises the disk path rather than the in-process memo.
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export const ok = true;\nexport const extra = 42;\n");

  const second = getCachedCodeMap(root);
  assert.equal(second.cache.hit, false, "a changed file invalidates the cached index");
  assert.notEqual(first.cache.fingerprint, second.cache.fingerprint, "fingerprint reflects the file change");

  // Re-reading without changes is a hit again.
  const third = getCachedCodeMap(root);
  assert.equal(third.cache.hit, true);
});

test("regenerates (without throwing) when the cache file is corrupted JSON", () => {
  const root = makeRepo("dev-context-index-corrupt-");
  const cachePath = cachePathFor(root);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, "{ this is not: valid json ]]]");

  // Fresh process for this root -> no memo entry -> reads disk, sees garbage.
  let result;
  assert.doesNotThrow(() => {
    result = getCachedCodeMap(root);
  });
  assert.equal(result.cache.hit, false, "garbage JSON is treated as a miss and regenerated");
  assert.equal(result.repo.name, "cached-repo");

  // The corrupted file is replaced with a valid one.
  const onDisk = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  assert.equal(onDisk.version, 4);
  assert.ok(onDisk.map);
});

test("a stale cacheVersion on disk is ignored on the first read of a repo", () => {
  const root = makeRepo("dev-context-index-version-fresh-");
  const cachePath = cachePathFor(root);

  // Write a structurally valid cache with an old version BEFORE any call for
  // this root, so there is no memo entry and the disk read is authoritative.
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(
    cachePath,
    JSON.stringify({ version: 1, generatedAt: "2020-01-01T00:00:00.000Z", fingerprint: "stale", map: { ok: true, poisoned: true } }, null, 2),
  );

  const result = getCachedCodeMap(root);
  assert.equal(result.cache.hit, false, "old cacheVersion is not trusted");
  assert.ok(!("poisoned" in result), "the stale map is not served");
  assert.equal(result.repo.name, "cached-repo");
});

test("writes the cache atomically and leaves no temp files behind", () => {
  const root = makeRepo("dev-context-index-atomic-");
  const result = getCachedCodeMap(root);
  assert.equal(result.cache.hit, false);

  const dir = path.dirname(cachePathFor(root));
  const entries = fs.readdirSync(dir);
  assert.deepEqual(entries, ["index.json"], "only the final index.json remains; no partial/temp file is visible");

  // The single file present is complete, valid JSON (never a half-written index).
  const parsed = JSON.parse(fs.readFileSync(cachePathFor(root), "utf8"));
  assert.equal(parsed.version, 4);
  assert.ok(parsed.map.ok);
});

test("write failures do not throw and the call still returns a map", () => {
  const root = makeRepo("dev-context-index-writefail-");
  // Make .dev-context a file so mkdir/write of the index underneath fails.
  fs.writeFileSync(path.join(root, ".dev-context"), "not a directory");

  let result;
  assert.doesNotThrow(() => {
    result = getCachedCodeMap(root);
  });
  assert.equal(result.cache.hit, false);
  assert.equal(result.repo.name, "cached-repo", "a failed cache write still returns a freshly generated map");
});

test("repeated calls are served from the in-process memo without re-reading disk", () => {
  const root = makeRepo("dev-context-index-memo-");

  const first = getCachedCodeMap(root);
  assert.equal(first.cache.hit, false);
  assert.equal(first.cache.source, "generated");

  // Delete the on-disk cache entirely. If the second call still returns a hit,
  // it can only have come from the in-process memo (disk would be a miss).
  fs.rmSync(cachePathFor(root), { force: true });
  assert.ok(!fs.existsSync(cachePathFor(root)), "disk cache removed");

  const second = getCachedCodeMap(root);
  assert.equal(second.cache.hit, true, "served despite no disk cache");
  assert.equal(second.cache.source, "memo", "the hit came from the in-process memo");
  // The memo did not rewrite the disk file (it short-circuits before writeCache).
  assert.ok(!fs.existsSync(cachePathFor(root)), "memo hit does not touch disk");
});

test("memo returns equivalent repo data across calls", () => {
  const root = makeRepo("dev-context-index-memo-eq-");
  const first = getCachedCodeMap(root);
  const second = getCachedCodeMap(root);
  assert.equal(second.cache.source, "memo");
  assert.equal(first.repo.name, second.repo.name);
  assert.deepEqual(first.summary, second.summary, "memoized summary is identical");
  assert.deepEqual(first.files, second.files, "memoized files are identical");
});
