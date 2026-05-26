import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  discoverRepositories,
  indexRepositories,
  listCatalog,
  searchCatalog
} from "../src/lib/catalog.js";

test("discoverRepositories finds local repository roots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-discover-"));
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-index-local-"));
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
  assert.ok(fs.existsSync(path.join(root, ".dev-context", "index.json")));
});

test("searchCatalog searches indexed paths and symbols", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-search-"));
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
