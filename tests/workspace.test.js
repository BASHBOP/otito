import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateWorkspaceReport } from "../src/lib/workspace.js";

test("generateWorkspaceReport aggregates multiple repos", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-workspace-"));
  const web = path.join(root, "web");
  const api = path.join(root, "api");
  fs.mkdirSync(path.join(web, "app"), { recursive: true });
  fs.mkdirSync(path.join(api, "src"), { recursive: true });
  fs.writeFileSync(path.join(web, "package.json"), JSON.stringify({ scripts: { dev: "next dev", build: "next build" } }));
  fs.writeFileSync(path.join(web, "app", "page.tsx"), "export default function Page() { return null; }\n");
  fs.writeFileSync(path.join(api, "package.json"), JSON.stringify({ main: "dist/main", scripts: { dev: "nest start --watch", test: "jest" } }));
  fs.writeFileSync(path.join(api, "src", "main.ts"), "console.log('api');\n");

  const result = generateWorkspaceReport([web, api]);
  assert.equal(result.data.ok, true);
  assert.equal(result.data.repoCount, 2);
  assert.equal(result.data.totalFiles, 4);
  assert.match(result.markdown, /# repoctx Workspace Report/);
  assert.match(result.markdown, /web/);
  assert.match(result.markdown, /api/);
});
