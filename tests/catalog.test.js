import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultCatalogPath, discoverRepositories, indexRepositories, listCatalog, searchCatalog } from "../src/lib/catalog.js";

test("discoverRepositories finds local repository roots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otito-discover-"));
  const app = path.join(root, "apps", "web");
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "web-app" }));

  const result = discoverRepositories([root], { depth: 3 });

  assert.equal(result.ok, true);
  assert.equal(result.repositoryCount, 1);
  assert.equal(result.repositories[0].root, app);
  assert.equal(result.repositories[0].name, "web-app");
});

test("indexRepositories writes an index and catalog entry", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otito-index-local-"));
  const catalogPath = path.join(root, "catalog.json");
  fs.mkdirSync(path.join(root, "src", "services"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "local-api" }));
  fs.writeFileSync(path.join(root, "src", "services", "events-service.ts"), "export function submitRsvp() { return true; }\n");

  const indexed = indexRepositories([root], { catalog: catalogPath });
  const catalog = listCatalog({ catalog: catalogPath });

  assert.equal(indexed.ok, true);
  assert.equal(indexed.indexedCount, 1);
  assert.equal(catalog.repositoryCount, 1);
  assert.equal(catalog.repositories[0].name, "local-api");
  assert.ok(fs.existsSync(catalog.repositories[0].indexPath), "catalog should retain an external cache path for offline search");
  assert.ok(!fs.existsSync(path.join(root, ".otito")), "indexing must not create an artifact in the target repository");
});

test("searchCatalog searches indexed paths and symbols", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otito-search-"));
  const catalogPath = path.join(root, "catalog.json");
  fs.mkdirSync(path.join(root, "src", "services"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "search-api" }));
  fs.writeFileSync(path.join(root, "src", "services", "events-service.ts"), "export function submitRsvp() { return true; }\n");

  indexRepositories([root], { catalog: catalogPath });
  const result = searchCatalog("submit rsvp", { catalog: catalogPath, offline: true });

  assert.equal(result.ok, true);
  assert.equal(result.matchCount, 1);
  assert.equal(result.matches[0].repository.name, "search-api");
  assert.equal(result.matches[0].file.path, "src/services/events-service.ts");
  assert.ok(result.matches[0].reasons.includes("symbol"));
});

// An offline search reads stored index files and deliberately does not
// re-fingerprint the repositories. It must still refuse an index written by an
// indexer this build no longer agrees with — otherwise a map produced before,
// say, markdown was indexable is served as though it were complete.
test("searchCatalog --offline skips an index written by a different indexer", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otito-search-stale-"));
  const catalogPath = path.join(root, "catalog.json");
  fs.mkdirSync(path.join(root, "src", "services"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "stale-api" }));
  fs.writeFileSync(path.join(root, "src", "services", "events-service.ts"), "export function submitRsvp() { return true; }\n");

  indexRepositories([root], { catalog: catalogPath });
  const indexPath = String(listCatalog({ catalog: catalogPath }).repositories[0].indexPath);

  // The repository is untouched, so its fingerprint still matches; only the
  // indexer that wrote the envelope differs.
  const envelope = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  envelope.capabilities = "cap1:0000000000000000";
  fs.writeFileSync(indexPath, JSON.stringify(envelope));

  const stale = searchCatalog("submit rsvp", { catalog: catalogPath, offline: true });

  assert.equal(stale.matchCount, 0, "a stale index must not be searched");
  assert.equal(stale.errors.length, 1);
  assert.equal(stale.errors[0].root, root);
  assert.match(stale.errors[0].error, /stale/);
  assert.match(stale.errors[0].error, /capabilities/);
  assert.match(stale.errors[0].error, /otito index/, "the reason should say how to refresh the index");

  // The same search without --offline rebuilds the index and finds the file,
  // which is what the skipped repository's reason points the caller at.
  const rebuilt = searchCatalog("submit rsvp", { catalog: catalogPath });
  assert.deepEqual(rebuilt.errors, []);
  assert.equal(rebuilt.matchCount, 1);
  assert.equal(rebuilt.matches[0].file.path, "src/services/events-service.ts");
});

// A bare code map with no envelope carries no version, no capability signature
// and no root: nothing that could establish which indexer produced it.
test("searchCatalog --offline skips an index file with no provenance", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otito-search-bare-"));
  const catalogPath = path.join(root, "catalog.json");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "bare-api" }));
  fs.writeFileSync(path.join(root, "src", "rsvp.ts"), "export function submitRsvp() { return true; }\n");

  indexRepositories([root], { catalog: catalogPath });
  const indexPath = String(listCatalog({ catalog: catalogPath }).repositories[0].indexPath);
  fs.writeFileSync(indexPath, JSON.stringify(JSON.parse(fs.readFileSync(indexPath, "utf8")).map));

  const result = searchCatalog("submit rsvp", { catalog: catalogPath, offline: true });

  assert.equal(result.matchCount, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /stale/);
});

// The fingerprint check is the expensive one and stays out of the offline path:
// a repository that has changed since it was indexed is still served from its
// stored index, because that is exactly what "without refreshing fingerprints"
// buys. Only the indexer's own identity is verified.
test("searchCatalog --offline still serves an index whose repository has changed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otito-search-drift-"));
  const catalogPath = path.join(root, "catalog.json");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "drift-api" }));
  fs.writeFileSync(path.join(root, "src", "rsvp.ts"), "export function submitRsvp() { return true; }\n");

  indexRepositories([root], { catalog: catalogPath });
  fs.writeFileSync(path.join(root, "src", "later.ts"), "export function addedAfterIndexing() { return true; }\n");

  const result = searchCatalog("submit rsvp", { catalog: catalogPath, offline: true });

  assert.deepEqual(result.errors, []);
  assert.equal(result.matchCount, 1);
  assert.equal(result.matches[0].file.path, "src/rsvp.ts");
});

test("defaultCatalogPath uses OTITO_CATALOG when set", () => {
  const original = process.env.OTITO_CATALOG;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otito-catalog-env-"));
  const otitoCatalog = path.join(root, "otito-catalog.json");

  try {
    process.env.OTITO_CATALOG = otitoCatalog;
    assert.equal(defaultCatalogPath(), otitoCatalog);
  } finally {
    if (original === undefined) {
      delete process.env.OTITO_CATALOG;
    } else {
      process.env.OTITO_CATALOG = original;
    }
  }
});

test("defaultCatalogPath defaults to the otito catalog", () => {
  const original = process.env.OTITO_CATALOG;

  try {
    delete process.env.OTITO_CATALOG;
    assert.equal(defaultCatalogPath(), path.join(os.homedir(), ".otito", "catalog.json"));
  } finally {
    if (original === undefined) {
      delete process.env.OTITO_CATALOG;
    } else {
      process.env.OTITO_CATALOG = original;
    }
  }
});
