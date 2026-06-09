import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { startMcpServer } from "../src/lib/mcp.js";

function git(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function writeFiles(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

function makeRepoFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repoctx-mcp-disp-"));
  writeFiles(root, {
    "package.json": JSON.stringify({
      name: "fixture-events-api",
      version: "0.1.0",
      type: "module",
      scripts: { test: "node --test", lint: "eslint ." },
    }),
    "src/events/events.controller.ts": [
      "import { Controller, Get } from '@nestjs/common';",
      "@Controller('events')",
      "export class EventsController {",
      "  @Get(':id')",
      "  findOne() {}",
      "}",
      "",
    ].join("\n"),
    "src/events/events.api.ts": ["import axios from 'axios';", "export async function listEvents() {", "  return axios.get('/api/events');", "}", ""].join(
      "\n",
    ),
    "tests/events.test.ts": "import test from 'node:test';\ntest('ok', () => {});\n",
  });
  return root;
}

function makeGitRepoFixture(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `repoctx-mcp-git-${prefix}-`));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "commit.gpgsign", "false");
  writeFiles(root, {
    "package.json": JSON.stringify({
      name: "fixture-git",
      version: "1.0.0",
      scripts: { test: "node --test", lint: "eslint ." },
    }),
    "src/index.ts": "export const greet = () => 'hi';\n",
  });
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "init");
  writeFiles(root, { "src/index.ts": "export const greet = () => 'hello';\n" });
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "tweak");
  return root;
}

async function runRequests(rawMessages) {
  const input = new PassThrough();
  const output = new PassThrough();
  const collected = [];
  let buffer = "";
  output.setEncoding("utf8");
  output.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines.filter(Boolean)) collected.push(JSON.parse(line));
  });

  const done = startMcpServer({ input, output });
  for (const message of rawMessages) {
    const line = typeof message === "string" ? message : JSON.stringify(message);
    input.write(`${line}\n`);
  }
  input.end();
  await done;
  if (buffer.trim()) collected.push(JSON.parse(buffer));
  return collected;
}

function byId(messages, id) {
  const match = messages.find((m) => m.id === id);
  if (!match) throw new Error(`no response for id ${id}: ${JSON.stringify(messages)}`);
  return match;
}

test("startMcpServer handles initialize, ping, tools/list, and skips notifications", async () => {
  const messages = await runRequests([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "ping" },
    { jsonrpc: "2.0", id: 3, method: "tools/list" },
  ]);

  assert.equal(messages.length, 3, "notifications must not produce a response");
  const init = byId(messages, 1);
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal(init.result.capabilities.tools.listChanged, false);
  assert.equal(typeof init.result.serverInfo.name, "string");
  assert.equal(typeof init.result.serverInfo.version, "string");
  assert.deepEqual(byId(messages, 2).result, {});

  const expectedTools = [
    "repo_inspect",
    "repo_map",
    "repo_discover",
    "repo_index",
    "repo_catalog",
    "repo_search",
    "context_pack",
    "change_impact",
    "pr_merge_readiness",
    "review_pr",
    "merge_readiness",
    "workspace_report",
    "pr_review",
    "repo_harness",
    "find_domain",
    "find_file_kind",
    "find_backend_route",
    "find_frontend_api_client",
  ];
  const names = byId(messages, 3).result.tools.map((t) => t.name);
  for (const name of expectedTools) {
    assert.ok(names.includes(name), `missing tool: ${name}`);
  }
});

test("startMcpServer returns -32700 on malformed JSON and skips blank lines", async () => {
  const messages = await runRequests(["", "   ", "{not json"]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, null);
  assert.equal(messages[0].error.code, -32700);
  assert.match(messages[0].error.message, /Parse error/);
});

test("startMcpServer rejects invalid envelopes and unknown methods", async () => {
  const messages = await runRequests([
    { jsonrpc: "1.0", id: 10, method: "initialize" },
    { jsonrpc: "2.0", id: 11 },
    { jsonrpc: "2.0", id: 12, method: "no_such_method" },
    "null",
  ]);
  assert.equal(byId(messages, 10).error.code, -32600);
  assert.equal(byId(messages, 11).error.code, -32600);
  assert.equal(byId(messages, 12).error.code, -32601);
  const nullEnvelope = messages.find((m) => m.id === null && m.error?.code === -32600);
  assert.ok(nullEnvelope, "null payload must produce an invalid-request error");
});

test("tools/call validates params, name, arguments, and unknown tools", async () => {
  const messages = await runRequests([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: "not-an-object" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { arguments: {} } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "   " } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "repo_inspect", arguments: [] } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "no_such_tool", arguments: {} } },
  ]);
  for (const id of [1, 2, 3, 4, 5]) {
    const m = byId(messages, id);
    assert.equal(m.error?.code, -32602, `expected -32602 for id ${id}, got ${JSON.stringify(m)}`);
  }
  assert.match(byId(messages, 5).error.message, /Unknown tool/);
});

test("tools/call returns isError content when the underlying tool throws", async () => {
  const bogusPath = path.join(os.tmpdir(), "repoctx-mcp-missing-xyz-abc-123");
  const messages = await runRequests([{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "repo_inspect", arguments: { path: bogusPath } } }]);
  const response = byId(messages, 1);
  assert.equal(response.result.isError, true);
  assert.equal(response.result.content[0].type, "text");
  assert.ok(response.result.content[0].text.length > 0);
});

test("repo_inspect, repo_map, and repo_harness produce structured results", async () => {
  const fixture = makeRepoFixture();
  const messages = await runRequests([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "repo_inspect", arguments: { path: fixture } } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "repo_map", arguments: { path: fixture } } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "repo_map", arguments: { path: fixture, includeFiles: true, limit: 5 } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "repo_map", arguments: { path: fixture, kind: "controller" } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "repo_map", arguments: { path: fixture, domain: "events", limit: -3 } } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "repo_harness", arguments: { path: fixture } } },
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "repo_harness", arguments: { path: fixture, includeMarkdown: true } } },
  ]);

  const inspect = byId(messages, 1).result.structuredContent;
  assert.equal(inspect.root, fixture);
  assert.equal(inspect.ok, true);

  const notable = byId(messages, 2).result.structuredContent;
  assert.equal(notable.ok, true);
  assert.equal(notable.files, undefined);
  assert.ok(Array.isArray(notable.notableFiles));

  const withFiles = byId(messages, 3).result.structuredContent;
  assert.equal(withFiles.notableFiles, undefined);
  assert.ok(Array.isArray(withFiles.files));
  assert.ok(withFiles.files.length <= 5);

  const byKind = byId(messages, 4).result.structuredContent;
  assert.ok(byKind.files.every((file) => file.kind === "controller"));
  assert.ok(byKind.files.some((file) => file.path.endsWith("events.controller.ts")));

  const byDomain = byId(messages, 5).result.structuredContent;
  assert.ok(byDomain.files.every((file) => (file.domains ?? [file.domain]).some((d) => d?.includes("events"))));

  const harnessOnly = byId(messages, 6).result.structuredContent;
  assert.ok(harnessOnly.commands, "harness data must include commands");
  assert.equal(harnessOnly.markdown, undefined);

  const harnessWithMarkdown = byId(messages, 7).result.structuredContent;
  assert.ok(typeof harnessWithMarkdown.markdown === "string");
  assert.ok(harnessWithMarkdown.data?.commands || harnessWithMarkdown.commands);
});

test("repo_discover, repo_index, repo_catalog, and repo_search round-trip a fixture", async () => {
  const fixture = makeRepoFixture();
  const catalogPath = path.join(os.tmpdir(), `repoctx-mcp-cat-${path.basename(fixture)}.json`);
  const messages = await runRequests([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "repo_discover", arguments: { paths: [fixture], depth: 2, limit: 25 } } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "repo_index", arguments: { paths: [fixture], catalog: catalogPath } } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "repo_catalog", arguments: { catalog: catalogPath } } },
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "repo_search", arguments: { query: "events", catalog: catalogPath, limit: 10, offline: true } },
    },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "repo_search", arguments: {} } },
  ]);

  const discover = byId(messages, 1).result.structuredContent;
  assert.ok(discover, "discover must return a structured result");

  const index = byId(messages, 2).result.structuredContent;
  assert.equal(index.ok, true);

  const catalog = byId(messages, 3).result.structuredContent;
  assert.ok(catalog && typeof catalog === "object");

  const search = byId(messages, 4).result.structuredContent;
  assert.ok(search && typeof search === "object");

  assert.equal(byId(messages, 5).error?.code, -32602);

  if (fs.existsSync(catalogPath)) fs.unlinkSync(catalogPath);
});

test("context_pack and change_impact require a query and respect includeMarkdown", async () => {
  const fixture = makeRepoFixture();
  const messages = await runRequests([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "context_pack", arguments: { query: "add events tool", path: fixture } } },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "context_pack", arguments: { query: "add events tool", path: fixture, includeMarkdown: true } },
    },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "context_pack", arguments: { path: fixture } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "change_impact", arguments: { query: "rename event controller", path: fixture, top: 5 } } },
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "change_impact", arguments: { query: "rename event controller", path: fixture, includeMarkdown: true } },
    },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "change_impact", arguments: { path: fixture } } },
  ]);

  const dataOnly = byId(messages, 1).result.structuredContent;
  assert.equal(dataOnly.markdown, undefined);
  assert.ok(dataOnly.primaryFiles || dataOnly.repositories || dataOnly.intent);

  const withMarkdown = byId(messages, 2).result.structuredContent;
  assert.ok(typeof withMarkdown.markdown === "string");

  assert.equal(byId(messages, 3).error?.code, -32602);

  const impact = byId(messages, 4).result.structuredContent;
  assert.equal(impact.markdown, undefined);
  assert.ok(Array.isArray(impact.topFiles));

  const impactWithMarkdown = byId(messages, 5).result.structuredContent;
  assert.ok(typeof impactWithMarkdown.markdown === "string");

  assert.equal(byId(messages, 6).error?.code, -32602);
});

test("merge_readiness and pr_review work against a real git fixture", async () => {
  const fixture = makeGitRepoFixture("merge");
  const messages = await runRequests([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "merge_readiness", arguments: { path: fixture, base: "HEAD~1" } } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "pr_review", arguments: { path: fixture, base: "HEAD~1" } } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "pr_review", arguments: { path: fixture, base: "HEAD~1", includeMarkdown: true } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "review_pr", arguments: { path: fixture, base: "HEAD~1", request: "tweak greeting" } } },
  ]);

  const merge = byId(messages, 1).result.structuredContent;
  assert.ok(["PASS", "WARN", "FAIL"].includes(merge.verdict));
  assert.ok(Array.isArray(merge.checks));

  const pr = byId(messages, 2).result.structuredContent;
  assert.equal(pr.markdown, undefined);
  assert.ok(pr.changedFiles || pr.comparison);

  const prMd = byId(messages, 3).result.structuredContent;
  assert.ok(typeof prMd.markdown === "string");

  const review = byId(messages, 4).result.structuredContent;
  assert.ok(review.verdict || review.summary || review.impact);
});

test("workspace_report requires two paths and accepts includeMarkdown", async () => {
  const fixtureA = makeRepoFixture();
  const fixtureB = makeRepoFixture();
  const messages = await runRequests([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "workspace_report", arguments: { paths: [fixtureA] } } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "workspace_report", arguments: { paths: [fixtureA, fixtureB] } } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "workspace_report", arguments: { paths: [fixtureA, fixtureB], includeMarkdown: true } } },
  ]);
  assert.equal(byId(messages, 1).error?.code, -32602);
  const summary = byId(messages, 2).result.structuredContent;
  assert.equal(summary.markdown, undefined);
  assert.ok(summary.repositories || summary.repos || summary.summary);
  const withMarkdown = byId(messages, 3).result.structuredContent;
  assert.ok(typeof withMarkdown.markdown === "string");
});

test("find_domain, find_file_kind, find_backend_route, find_frontend_api_client cover their helpers", async () => {
  const fixture = makeRepoFixture();
  const messages = await runRequests([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "find_domain", arguments: { path: fixture, domain: "events", limit: 5 } } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "find_domain", arguments: { path: fixture } } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "find_file_kind", arguments: { path: fixture, kind: "controller" } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "find_file_kind", arguments: { path: fixture } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "find_backend_route", arguments: { path: fixture, limit: 10 } } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "find_backend_route", arguments: { path: fixture, query: "events" } } },
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "find_frontend_api_client", arguments: { path: fixture } } },
    { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "find_frontend_api_client", arguments: { path: fixture, query: "events" } } },
  ]);

  const domain = byId(messages, 1).result.structuredContent;
  assert.equal(domain.domain, "events");
  assert.ok(Array.isArray(domain.repos));
  assert.equal(domain.repos.length, 1);
  assert.ok(domain.repos[0].files.length > 0);

  assert.equal(byId(messages, 2).error?.code, -32602);

  const kind = byId(messages, 3).result.structuredContent;
  assert.equal(kind.kind, "controller");
  assert.ok(kind.repos[0].files.every((file) => file.kind === "controller"));

  assert.equal(byId(messages, 4).error?.code, -32602);

  const routes = byId(messages, 5).result.structuredContent;
  assert.equal(routes.ok, true);
  assert.ok(Array.isArray(routes.routes));
  assert.ok(routes.routes.some((route) => route.route.startsWith("/events")));

  const filteredRoutes = byId(messages, 6).result.structuredContent;
  assert.ok(filteredRoutes.routes.every((route) => `${route.file} ${route.route} ${route.method}`.toLowerCase().includes("events")));

  const apiClient = byId(messages, 7).result.structuredContent;
  assert.equal(apiClient.ok, true);
  assert.ok(Array.isArray(apiClient.repos));

  const apiClientFiltered = byId(messages, 8).result.structuredContent;
  assert.equal(apiClientFiltered.query, "events");
});
