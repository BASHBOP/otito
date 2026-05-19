import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

test("mcp server initializes, lists tools, and calls repo_inspect", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-mcp-"));
  fs.mkdirSync(path.join(fixture, "src"));
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  fs.writeFileSync(path.join(fixture, "src", "index.ts"), "export const ok = true;\n");

  const child = spawn(process.execPath, ["src/cli.js", "mcp"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"]
  });

  const messages = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    for (const line of chunk.trim().split("\n").filter(Boolean)) {
      messages.push(JSON.parse(line));
    }
  });

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0.0.0" } } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "repo_inspect", arguments: { path: fixture } } })}\n`);
  child.stdin.end();

  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(exitCode, 0);
  assert.equal(messages[0].result.serverInfo.name, "dev-context");
  assert.ok(messages[1].result.tools.some((tool) => tool.name === "repo_map"));
  assert.ok(messages[1].result.tools.some((tool) => tool.name === "pr_review"));
  assert.ok(messages[1].result.tools.some((tool) => tool.name === "repo_harness"));
  assert.equal(messages[2].result.structuredContent.root, fixture);
});
