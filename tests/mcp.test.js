import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

test("mcp server initializes, lists tools, and calls repo_inspect", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-mcp-"));
  fs.mkdirSync(path.join(fixture, "src", "lib"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "tests"));
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  fs.writeFileSync(path.join(fixture, "src", "index.ts"), "export const ok = true;\n");
  fs.writeFileSync(
    path.join(fixture, "src", "cli.js"),
    "import { startMcpServer } from './lib/mcp.js';\nexport function main() { return startMcpServer(); }\n",
  );
  fs.writeFileSync(
    path.join(fixture, "src", "lib", "mcp.js"),
    "const tools = [];\nexport function startMcpServer() { return tools; }\nfunction dispatchTool() {}\n",
  );
  fs.writeFileSync(path.join(fixture, "tests", "mcp.test.js"), "import test from 'node:test';\ntest('mcp', () => {});\n");

  const child = spawn(process.execPath, ["src/cli.js", "mcp"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  const messages = [];
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines.filter(Boolean)) {
      messages.push(JSON.parse(line));
    }
  });

  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0.0.0" } } })}\n`,
  );
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "repo_inspect", arguments: { path: fixture } } })}\n`);
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "context_pack", arguments: { query: "add MCP tool", path: fixture } } })}\n`,
  );
  child.stdin.end();

  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  if (buffer.trim()) {
    messages.push(JSON.parse(buffer));
  }
  assert.equal(exitCode, 0);
  assert.equal(messages[0].result.serverInfo.name, "@nugehs/repoctx");
  const listedNames = messages[1].result.tools.map((tool) => tool.name);
  assert.equal(listedNames.length, 13, `tools/list must expose exactly 13 tools, got ${listedNames.length}: ${listedNames.join(", ")}`);
  for (const expected of ["repo_map", "repo_index", "repo_search", "context_pack", "agent_experience", "convergence_score", "review_context", "repo_harness"]) {
    assert.ok(listedNames.includes(expected), `missing tool: ${expected}`);
  }
  // Retired names must not appear in tools/list (they remain callable via tools/call).
  for (const retired of ["repo_discover", "repo_catalog", "pr_review"]) {
    assert.ok(!listedNames.includes(retired), `retired tool must not appear in tools/list: ${retired}`);
  }

  // The transport ships a single compact-JSON text payload and no structuredContent.
  assert.equal(messages[2].result.structuredContent, undefined);
  const inspect = JSON.parse(messages[2].result.content[0].text);
  assert.equal(inspect.root, fixture);
  const contextPack = JSON.parse(messages[3].result.content[0].text);
  assert.ok(contextPack.primaryFiles.some((file) => file.path === "src/lib/mcp.js"));
});
