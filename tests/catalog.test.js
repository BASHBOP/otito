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
