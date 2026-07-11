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
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "context-fixture",
      scripts: {
        test: "node --test",
      },
      bin: {
        repoctx: "./src/cli.js",
      },
    }),
  );
  fs.writeFileSync(
    path.join(root, "src", "cli.js"),
    [
      "import { startMcpServer } from './lib/mcp.js';",
      "const commandHandlers = { mcp: startMcpServer };",
      "function handleAgentTools() { return true; }",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "src", "lib", "mcp.js"),
    [
      "const tools = [{ name: 'repo_inspect' }];",
      "export function startMcpServer() { return tools; }",
      "function dispatchTool(name) { return name; }",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(root, "src", "lib", "agent-tools.js"), ["export function getAgentTools() { return { tools: [] }; }", ""].join("\n"));
  fs.writeFileSync(path.join(root, "tests", "mcp.test.js"), ["import test from 'node:test';", "test('mcp tools', () => {});", ""].join("\n"));

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

test("generateContextPack gates imports/exports/symbols evidence behind includeEvidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-context-evidence-"));
  fs.mkdirSync(path.join(root, "src", "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "evidence-fixture", scripts: { test: "node --test" } }));
  fs.writeFileSync(
    path.join(root, "src", "lib", "mcp.js"),
    ["import { helper } from './helper.js';", "export function startMcpServer() { return helper(); }", ""].join("\n"),
  );
  fs.writeFileSync(path.join(root, "src", "lib", "helper.js"), ["export function helper() { return 1; }", ""].join("\n"));

  const without = generateContextPack("add a new MCP tool", { path: root });
  for (const file of without.data.primaryFiles) {
    assert.equal(file.imports, undefined, "imports omitted by default");
    assert.equal(file.exports, undefined, "exports omitted by default");
    assert.equal(file.symbols, undefined, "symbols omitted by default");
    // The always-on fields survive.
    assert.ok(typeof file.path === "string");
    assert.ok(typeof file.kind === "string");
    assert.ok(typeof file.score === "number");
    assert.ok(Array.isArray(file.reasons));
  }

  const withEvidence = generateContextPack("add a new MCP tool", { path: root, includeEvidence: true });
  assert.ok(
    withEvidence.data.primaryFiles.some((file) => Array.isArray(file.imports) || Array.isArray(file.exports) || Array.isArray(file.symbols)),
    "includeEvidence:true attaches evidence slices",
  );

  // The default packet's token estimate must reflect the stripped (smaller) payload.
  assert.ok(without.data.tokenEstimate.fullJson < withEvidence.data.tokenEstimate.fullJson);
});

test("generateContextPack falls back to entrypoints and configs when no task keywords match", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-context-fallback-"));
  fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fallback-fixture", scripts: { build: "vite build" } }));
  fs.writeFileSync(path.join(root, "vite.config.ts"), "export default { plugins: [] };\n");
  fs.writeFileSync(path.join(root, "src", "main.tsx"), "import { Layout } from './components/Layout';\nexport function bootstrap() { return Layout; }\n");
  fs.writeFileSync(path.join(root, "src", "App.tsx"), "export function Root() { return null; }\n");
  fs.writeFileSync(path.join(root, "src", "components", "Layout.tsx"), "export function Layout() { return null; }\n");

  const result = generateContextPack("improve SEO, performance, accessibility and content of the portfolio site", { path: root });

  assert.equal(result.data.ok, true);
  assert.ok(result.data.primaryFiles.length > 0, "fallback must produce primary files on a small repo");
  const primaryPaths = result.data.primaryFiles.map((file) => file.path);
  assert.ok(primaryPaths.includes("src/main.tsx"));
  assert.ok(primaryPaths.includes("src/App.tsx"));
  assert.ok(primaryPaths.includes("vite.config.ts"));
  assert.ok(result.data.primaryFiles.every((file) => file.reasons.some((reason) => reason.startsWith("fallback"))));
  assert.ok(result.data.openQuestions.some((question) => question.includes("fall back to repo entrypoints")));
  assert.ok(!result.data.openQuestions.some((question) => question.includes("No strong primary files matched")));
});

test("generateContextPack fallback ranking is deterministic across runs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-context-fallback-det-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fallback-det-fixture" }));
  fs.writeFileSync(path.join(root, "src", "main.ts"), "export function bootstrap() { return 1; }\n");
  fs.writeFileSync(path.join(root, "src", "helpers.ts"), "export function helper() { return 2; }\n");

  const first = generateContextPack("polish visual styling", { path: root });
  const second = generateContextPack("polish visual styling", { path: root });

  assert.deepEqual(
    first.data.primaryFiles.map((file) => file.path),
    second.data.primaryFiles.map((file) => file.path),
  );
  assert.equal(first.data.primaryFiles[0].path, "src/main.ts");
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

test("generateContextPack ranks email service methods as hotspots over booking controllers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-context-hotspots-"));
  fs.mkdirSync(path.join(root, "src", "email"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "booking"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "hotspot-fixture", scripts: { test: "node --test" } }));
  fs.writeFileSync(
    path.join(root, "src", "email", "email.service.ts"),
    [
      "import { Injectable } from '@nestjs/common';",
      "@Injectable()",
      "export class EmailService {",
      "  async sendRsvpConfirmationEmail() {}",
      "  async sendBookingCancellation() {}",
      "  async sendBookingAbandonmentRecovery() {}",
      "  private async resolveEventEmailBranding() {}",
      "}",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "src", "booking", "booking.controller.ts"),
    [
      "import { Controller, Post } from '@nestjs/common';",
      "@Controller('bookings')",
      "export class BookingController {",
      "  @Post('cancel')",
      "  cancel() {}",
      "  @Post('recover/:id')",
      "  recover() {}",
      "}",
      "",
    ].join("\n"),
  );

  const result = generateContextPack("extend organisation branding to RSVP confirmation booking cancellation abandonment recovery emails", { path: root });

  assert.equal(result.data.contextEngineVersion, 2);
  assert.ok(result.data.primaryFiles.some((file) => file.path === "src/email/email.service.ts"));
  assert.ok(result.data.hotspots.some((item) => item.path === "src/email/email.service.ts" && item.symbol === "resolveEventEmailBranding"));
  assert.ok(result.data.hotspots.some((item) => item.symbol === "sendRsvpConfirmationEmail"));
  assert.ok(result.data.agentPrompt.includes("Start at these hotspots"));
  assert.match(result.markdown, /## Hotspots/);
});
