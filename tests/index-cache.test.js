import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getCachedCodeMap } from "../src/lib/index-cache.js";

test("getCachedCodeMap writes and reuses a repo index", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-index-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "cached-repo" }));
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export const ok = true;\n");

  const first = getCachedCodeMap(root);
  const second = getCachedCodeMap(root);

  assert.equal(first.cache.hit, false);
  assert.equal(second.cache.hit, true);
  assert.equal(second.repo.name, "cached-repo");
  assert.ok(fs.existsSync(path.join(root, ".dev-context", "index.json")));
});
