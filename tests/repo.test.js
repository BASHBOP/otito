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
    name: "fixture-cli",
    version: "1.2.3",
    type: "module",
    bin: {
      fixture: "./src/cli.js"
    },
    scripts: {
      test: "node --test"
    },
    main: "src/index.js"
  }));
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export const ok = true;\n");
  fs.writeFileSync(path.join(root, "src", "cli.js"), "console.log('ok');\n");

  const result = inspectRepo(root);
  assert.equal(result.ok, true);
  assert.equal(result.fileCount, 3);
  assert.equal(result.languages[0].language, "TypeScript");
  assert.deepEqual(result.packageManagers, ["npm"]);
  assert.equal(result.package.name, "fixture-cli");
  assert.equal(result.package.version, "1.2.3");
  assert.equal(result.package.type, "module");
  assert.equal(result.scripts.test, "node --test");
  assert.ok(result.entrypoints.includes("src/index.js"));
  assert.ok(result.entrypoints.includes("src/index.ts"));
  assert.ok(result.entrypoints.includes("src/cli.js"));
});
