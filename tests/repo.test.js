import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectRepo } from "../src/lib/repo.js";

test("inspectRepo detects TypeScript repo basics", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-repo-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    scripts: {
      test: "node --test"
    },
    main: "src/index.js"
  }));
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export const ok = true;\n");

  const result = inspectRepo(root);
  assert.equal(result.ok, true);
  assert.equal(result.fileCount, 2);
  assert.equal(result.languages[0].language, "TypeScript");
  assert.deepEqual(result.packageManagers, []);
  assert.equal(result.scripts.test, "node --test");
  assert.ok(result.entrypoints.includes("src/index.js"));
  assert.ok(result.entrypoints.includes("src/index.ts"));
});
