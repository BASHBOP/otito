import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateContextPack } from "../src/lib/context-engine.js";

test("generateContextPack returns task-aware files, tests, patterns, and commands", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-context-"));
  fs.mkdirSync(path.join(root, "src", "lib"), { recursive: true });
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "context-fixture",
    scripts: {
      test: "node --test"
    },
    bin: {
      repoctx: "./src/cli.js"
    }
  }));
  fs.writeFileSync(path.join(root, "src", "cli.js"), [
    "import { startMcpServer } from './lib/mcp.js';",
    "const commandHandlers = { mcp: startMcpServer };",
    "function handleAgentTools() { return true; }",
    ""
  ].join("\n"));
  fs.writeFileSync(path.join(root, "src", "lib", "mcp.js"), [
    "const tools = [{ name: 'repo_inspect' }];",
    "export function startMcpServer() { return tools; }",
    "function dispatchTool(name) { return name; }",
    ""
  ].join("\n"));
  fs.writeFileSync(path.join(root, "src", "lib", "agent-tools.js"), [
    "export function getAgentTools() { return { tools: [] }; }",
    ""
  ].join("\n"));
  fs.writeFileSync(path.join(root, "tests", "mcp.test.js"), [
    "import test from 'node:test';",
    "test('mcp tools', () => {});",
    ""
  ].join("\n"));

  const result = generateContextPack("add a new MCP tool", { path: root });

  assert.equal(result.data.ok, true);
  assert.equal(result.data.intent.action, "add");
  assert.ok(result.data.primaryFiles.some((file) => file.path === "src/lib/mcp.js"));
  assert.ok(result.data.primaryFiles.some((file) => file.path === "src/lib/agent-tools.js"));
  assert.ok([...result.data.primaryFiles, ...result.data.relatedFiles].some((file) => file.path === "src/cli.js"));
  assert.ok(result.data.tests.some((file) => file.path === "tests/mcp.test.js"));
  assert.ok(result.data.patterns.some((pattern) => pattern.includes("MCP tool changes")));
  assert.ok(result.data.commands.some((command) => command.command === "npm test"));
  assert.ok(result.data.agentPrompt.includes("Read these files first"));
  assert.ok(result.data.tokenEstimate.fullJson > 0);
  assert.match(result.markdown, /# Context Pack: add a new MCP tool/);
});

test("generateContextPack falls back to low-scored matches for narrow symbol queries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-context-symbol-"));
  fs.mkdirSync(path.join(root, "src", "services"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "symbol-fixture" }));
  fs.writeFileSync(path.join(root, "src", "services", "events-service.ts"), "export function submitRsvp() { return true; }\n");

  const result = generateContextPack("submit rsvp", { path: root });

  assert.equal(result.data.ok, true);
  assert.ok(result.data.primaryFiles.some((file) => file.path === "src/services/events-service.ts"));
});
