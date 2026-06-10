import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { startMcpServer, tools } from "../src/lib/mcp.js";
import { getAgentTools } from "../src/lib/agent-tools.js";

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

// The transport now ships a single text payload — compact JSON for data
// results, raw markdown for includeMarkdown:true — and no structuredContent.
// These helpers decode that single payload for assertions.
function rawText(message, id) {
  const result = byId(message, id).result;
  assert.equal(result.structuredContent, undefined, `id ${id} must not ship structuredContent`);
  assert.equal(result.content[0].type, "text");
  return result.content[0].text;
}

function structured(messages, id) {
  return JSON.parse(rawText(messages, id));
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
    { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "repo_inspect", arguments: { path: fixture, includeScripts: true } } },
  ]);

  const inspect = structured(messages, 1);
  assert.equal(inspect.root, fixture);
  assert.equal(inspect.ok, true);
  assert.ok(Array.isArray(inspect.scriptNames), "inspect must always report script names");
  assert.equal(inspect.scripts, undefined, "script bodies are gated off by default");

  const notable = structured(messages, 2);
  assert.equal(notable.ok, true);
  assert.equal(notable.files, undefined);
  assert.ok(Array.isArray(notable.notableFiles));

  const withFiles = structured(messages, 3);
  assert.equal(withFiles.notableFiles, undefined);
  assert.ok(Array.isArray(withFiles.files));
  assert.ok(withFiles.files.length <= 5);

  const byKind = structured(messages, 4);
  assert.ok(byKind.files.every((file) => file.kind === "controller"));
  assert.ok(byKind.files.some((file) => file.path.endsWith("events.controller.ts")));

  const byDomain = structured(messages, 5);
  assert.ok(byDomain.files.every((file) => (file.domains ?? [file.domain]).some((d) => d?.includes("events"))));

  const harnessOnly = structured(messages, 6);
  assert.ok(harnessOnly.commands, "harness data must include commands");
  assert.equal(harnessOnly.markdown, undefined);

  // includeMarkdown:true returns the markdown report AS the text payload.
  const harnessMarkdown = rawText(messages, 7);
  assert.match(harnessMarkdown, /^#/m, "harness markdown should read as a markdown document");
  assert.throws(() => JSON.parse(harnessMarkdown), "markdown payload must not be JSON");

  const inspectWithScripts = structured(messages, 8);
  assert.ok(inspectWithScripts.scripts, "includeScripts:true must include script command bodies");
  assert.equal(inspectWithScripts.scripts.test, "node --test");
  assert.ok(Array.isArray(inspectWithScripts.scriptNames));
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

  const discover = structured(messages, 1);
  assert.ok(discover, "discover must return a structured result");

  const index = structured(messages, 2);
  assert.equal(index.ok, true);

  const catalog = structured(messages, 3);
  assert.ok(catalog && typeof catalog === "object");

  const search = structured(messages, 4);
  assert.ok(search && typeof search === "object");
  assert.ok(search.repositoryCount >= 1, "search against a populated catalog reports repositories");
  assert.equal(search.remediation, undefined, "no remediation hint when the catalog has repositories");

  assert.equal(byId(messages, 5).error?.code, -32602);

  if (fs.existsSync(catalogPath)) fs.unlinkSync(catalogPath);
});

test("repo_search on an empty catalog returns a remediation hint pointing at repo_index", async () => {
  // A non-existent catalog path loads as an empty catalog (no repositories).
  const emptyCatalog = path.join(os.tmpdir(), `repoctx-mcp-empty-cat-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const messages = await runRequests([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "repo_search", arguments: { query: "events", catalog: emptyCatalog } } },
  ]);

  const search = structured(messages, 1);
  assert.equal(search.repositoryCount, 0);
  assert.equal(search.matchCount, 0);
  assert.match(search.remediation, /repo_index/);
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

  const dataText = rawText(messages, 1);
  const dataOnly = JSON.parse(dataText);
  assert.equal(dataOnly.markdown, undefined);
  assert.ok(dataOnly.primaryFiles || dataOnly.repositories || dataOnly.intent);
  // Evidence slices are off by default; path/kind/score/reasons are always kept.
  for (const file of dataOnly.primaryFiles ?? []) {
    assert.equal(file.imports, undefined, "imports evidence must be omitted by default");
    assert.equal(file.exports, undefined, "exports evidence must be omitted by default");
    assert.equal(file.symbols, undefined, "symbols evidence must be omitted by default");
    assert.ok(typeof file.path === "string");
    assert.ok(typeof file.kind === "string");
    assert.ok(typeof file.score === "number");
    assert.ok(Array.isArray(file.reasons));
  }

  const withMarkdownText = rawText(messages, 2);
  assert.match(withMarkdownText, /# Context Pack:/, "includeMarkdown returns the markdown report as text");
  assert.throws(() => JSON.parse(withMarkdownText), "markdown payload must not be JSON");
  // The human-readable markdown report is dramatically smaller than the full
  // JSON packet it summarizes — the whole point of the transport change.
  assert.ok(withMarkdownText.length < dataText.length, `markdown (${withMarkdownText.length}) should be smaller than JSON (${dataText.length})`);

  assert.equal(byId(messages, 3).error?.code, -32602);

  const impact = structured(messages, 4);
  assert.equal(impact.markdown, undefined);
  assert.ok(Array.isArray(impact.topFiles));

  const impactMarkdown = rawText(messages, 5);
  assert.throws(() => JSON.parse(impactMarkdown), "impact markdown payload must not be JSON");
  assert.ok(impactMarkdown.length > 0);

  assert.equal(byId(messages, 6).error?.code, -32602);
});

test("context_pack default response is compact: no structuredContent, no pretty-print, evidence gated", async () => {
  const fixture = makeRepoFixture();
  const messages = await runRequests([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "context_pack", arguments: { query: "add events tool", path: fixture } } },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "context_pack", arguments: { query: "add events tool", path: fixture, includeEvidence: true } },
    },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "context_pack", arguments: { query: "add events tool", path: fixture, includeMarkdown: true } },
    },
  ]);

  const defaultText = rawText(messages, 1);
  // No structuredContent (asserted inside rawText) and no pretty-print: the
  // compact JSON has no newline-plus-indentation sequences.
  assert.ok(!/\n {2}/.test(defaultText), "default JSON payload must not be pretty-printed");
  assert.equal(byId(messages, 1).result.structuredContent, undefined);

  const evidenceText = rawText(messages, 2);
  const withEvidence = JSON.parse(evidenceText);
  const evidenceFile = (withEvidence.primaryFiles ?? []).find(
    (file) => Array.isArray(file.exports) || Array.isArray(file.imports) || Array.isArray(file.symbols),
  );
  assert.ok(evidenceFile, "includeEvidence:true must attach imports/exports/symbols to at least one file");

  // Evidence adds bytes; the default packet must be smaller than the evidence one.
  assert.ok(defaultText.length < evidenceText.length, `default (${defaultText.length}) should be smaller than evidence (${evidenceText.length})`);

  // The markdown report is dramatically smaller than the JSON packet.
  const markdownText = rawText(messages, 3);
  assert.ok(markdownText.length < defaultText.length, `markdown (${markdownText.length}) should be far smaller than JSON (${defaultText.length})`);
});

test("merge_readiness and pr_review work against a real git fixture", async () => {
  const fixture = makeGitRepoFixture("merge");
  const messages = await runRequests([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "merge_readiness", arguments: { path: fixture, base: "HEAD~1" } } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "pr_review", arguments: { path: fixture, base: "HEAD~1" } } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "pr_review", arguments: { path: fixture, base: "HEAD~1", includeMarkdown: true } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "review_pr", arguments: { path: fixture, base: "HEAD~1", request: "tweak greeting" } } },
  ]);

  const merge = structured(messages, 1);
  assert.ok(["PASS", "WARN", "FAIL"].includes(merge.verdict));
  assert.ok(Array.isArray(merge.checks));

  const pr = structured(messages, 2);
  assert.equal(pr.markdown, undefined);
  assert.ok(pr.changedFiles || pr.comparison);

  const prMd = rawText(messages, 3);
  assert.throws(() => JSON.parse(prMd), "pr_review markdown payload must not be JSON");
  assert.ok(prMd.length > 0);

  const review = structured(messages, 4);
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
  const summary = structured(messages, 2);
  assert.equal(summary.markdown, undefined);
  assert.ok(summary.repositories || summary.repos || summary.summary);
  const withMarkdown = rawText(messages, 3);
  assert.throws(() => JSON.parse(withMarkdown), "workspace markdown payload must not be JSON");
  assert.ok(withMarkdown.length > 0);
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

  const domain = structured(messages, 1);
  assert.equal(domain.domain, "events");
  assert.ok(Array.isArray(domain.repos));
  assert.equal(domain.repos.length, 1);
  assert.ok(domain.repos[0].files.length > 0);

  assert.equal(byId(messages, 2).error?.code, -32602);

  const kind = structured(messages, 3);
  assert.equal(kind.kind, "controller");
  assert.ok(kind.repos[0].files.every((file) => file.kind === "controller"));

  assert.equal(byId(messages, 4).error?.code, -32602);

  const routes = structured(messages, 5);
  assert.equal(routes.ok, true);
  assert.ok(Array.isArray(routes.routes));
  assert.ok(routes.routes.some((route) => route.route.startsWith("/events")));

  const filteredRoutes = structured(messages, 6);
  assert.ok(filteredRoutes.routes.every((route) => `${route.file} ${route.route} ${route.method}`.toLowerCase().includes("events")));

  const apiClient = structured(messages, 7);
  assert.equal(apiClient.ok, true);
  assert.ok(Array.isArray(apiClient.repos));

  const apiClientFiltered = structured(messages, 8);
  assert.equal(apiClientFiltered.query, "events");
});

test("startMcpServer never responds to notifications, including unknown methods", async () => {
  const messages = await runRequests([
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } },
    { jsonrpc: "2.0", method: "notifications/roots/list_changed" },
    { jsonrpc: "2.0", method: "some/unknown_notification" },
    { jsonrpc: "2.0", id: 2, method: "ping" },
  ]);

  assert.equal(messages.length, 2, "only the two pings may produce responses");
  assert.deepEqual(byId(messages, 1).result, {});
  assert.deepEqual(byId(messages, 2).result, {});
});

test("initialize negotiates the protocol version against supported revisions", async () => {
  const messages = await runRequests([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
    { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } },
    { jsonrpc: "2.0", id: 3, method: "initialize", params: {} },
  ]);

  assert.equal(byId(messages, 1).result.protocolVersion, "2025-03-26");
  assert.equal(byId(messages, 2).result.protocolVersion, "2025-06-18");
  assert.equal(byId(messages, 3).result.protocolVersion, "2025-06-18");
});

test("agent-tools catalog stays in parity with the MCP tools array", () => {
  const catalog = getAgentTools();
  const catalogByName = new Map(catalog.tools.map((tool) => [tool.name, tool]));

  assert.equal(catalog.tools.length, tools.length, "agent-tools must expose exactly the MCP tool set");

  for (const tool of tools) {
    const derived = catalogByName.get(tool.name);
    assert.ok(derived, `agent-tools is missing MCP tool: ${tool.name}`);
    assert.equal(derived.description, tool.description, `description drift for ${tool.name}`);

    const schemaProps = Object.keys(tool.inputSchema?.properties ?? {}).sort();
    const inputProps = Object.keys(derived.input ?? {}).sort();
    assert.deepEqual(inputProps, schemaProps, `option drift for ${tool.name}`);

    const required = new Set(tool.inputSchema?.required ?? []);
    for (const [name, value] of Object.entries(derived.input ?? {})) {
      const optional = value.endsWith("?");
      assert.equal(optional, !required.has(name), `required flag drift for ${tool.name}.${name}`);
    }
  }
});

test("every MCP tool declares an explicit readOnlyHint annotation", () => {
  for (const tool of tools) {
    assert.ok(tool.annotations, `tool ${tool.name} must declare annotations`);
    assert.equal(typeof tool.annotations.readOnlyHint, "boolean", `tool ${tool.name} must declare a boolean readOnlyHint`);
  }

  // Tools that mutate persistent state are honestly flagged non-read-only.
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  assert.equal(byName.get("repo_index").annotations.readOnlyHint, false, "repo_index mutates the catalog");
  assert.equal(byName.get("pr_review").annotations.readOnlyHint, false, "pr_review can post a GitHub comment");
  assert.equal(byName.get("repo_inspect").annotations.readOnlyHint, true);
  assert.equal(byName.get("context_pack").annotations.readOnlyHint, true);
});

test("the review/merge tool descriptions are verb-first and cross-reference each other", () => {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const family = ["pr_review", "review_pr", "merge_readiness", "pr_merge_readiness"];

  for (const name of family) {
    const description = byName.get(name).description;
    // Verb-first: first word is a capitalized imperative verb, no leading noun phrase.
    assert.match(description, /^[A-Z][a-z]+ /, `${name} description should start with a verb`);
    assert.match(description, /Not to be confused with/, `${name} should disambiguate from siblings`);
  }

  // Each description leads with a distinct verb so the four cannot be confused.
  const firstWords = family.map((name) => byName.get(name).description.split(" ")[0]);
  assert.equal(new Set(firstWords).size, firstWords.length, `review/merge descriptions must open with distinct verbs: ${firstWords.join(", ")}`);
});
