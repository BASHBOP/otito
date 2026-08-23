import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateObsidianVault, writeObsidianVault } from "../src/lib/obsidian.js";

test("Obsidian export creates navigable repository and task notes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otito-obsidian-repo-"));
  const vault = path.join(root, ".otito", "obsidian");
  fs.mkdirSync(path.join(root, "src", "lib"), { recursive: true });
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "obsidian-fixture", version: "1.0.0", main: "dist/main", scripts: { test: "node --test" } }),
  );
  fs.writeFileSync(path.join(root, "src", "index.js"), "export function start() { return true; }\n");
  fs.writeFileSync(path.join(root, "src", "lib", "mcp.js"), "export function startMcpServer() { return true; }\n");
  fs.writeFileSync(path.join(root, "tests", "mcp.test.js"), "import test from 'node:test';\ntest('mcp', () => {});\n");

  const manifest = writeObsidianVault(root, vault, { query: "add a new MCP tool" });

  assert.equal(manifest.ok, true);
  assert.equal(manifest.noteCount, 5);
  assert.ok(fs.existsSync(path.join(vault, "Home.md")));
  assert.ok(fs.existsSync(path.join(vault, "Repository.md")));
  assert.ok(fs.existsSync(path.join(vault, "Evidence.md")));
  assert.match(fs.readFileSync(path.join(vault, "Home.md"), "utf8"), /\[\[Context\/add-a-new-mcp-tool\]\]/);
  assert.match(fs.readFileSync(path.join(vault, "Repository.md"), "utf8"), /src\/index\.js/);
  assert.match(fs.readFileSync(path.join(vault, "Repository.md"), "utf8"), /dist\/main.*declared but not present/);
  assert.match(fs.readFileSync(path.join(vault, "Evidence.md"), "utf8"), /staged-tree gates/);

  const generated = generateObsidianVault(root, vault);
  assert.equal(generated.manifest.noteCount, 3);
  assert.equal(generated.files.has("Context/add-a-new-mcp-tool.md"), false);
});
