import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { canvasEvent, canvasIngestUrl, forwardToCanvas, REQUEST_ARGUMENT } from "../src/lib/canvas-tap.js";
import { startMcpServer, tools } from "../src/lib/mcp.js";

test("the tap is off unless OTITO_CANVAS_URL names a loopback http address", () => {
  assert.equal(canvasIngestUrl({}), null, "unset means off");
  assert.equal(canvasIngestUrl({ OTITO_CANVAS_URL: "  " }), null);
  assert.equal(canvasIngestUrl({ OTITO_CANVAS_URL: "not a url" }), null);
  assert.equal(canvasIngestUrl({ OTITO_CANVAS_URL: "http://example.com:7801" }), null, "a remote host would receive unreleased work");
  assert.equal(canvasIngestUrl({ OTITO_CANVAS_URL: "http://10.0.0.5:7801" }), null);
  assert.equal(canvasIngestUrl({ OTITO_CANVAS_URL: "https://127.0.0.1:7801" }), null, "the canvas serves plain http on loopback");

  assert.equal(canvasIngestUrl({ OTITO_CANVAS_URL: "http://127.0.0.1:7801" })?.href, "http://127.0.0.1:7801/ingest");
  assert.equal(canvasIngestUrl({ OTITO_CANVAS_URL: "http://localhost:7801/" })?.href, "http://localhost:7801/ingest");
  assert.equal(canvasIngestUrl({ OTITO_CANVAS_URL: "http://[::1]:7801" })?.href, "http://[::1]:7801/ingest");
});

test("only a tool that carries a plain-English request is forwarded, and only its text", () => {
  const env = { OTITO_HOST: "cursor" };
  assert.deepEqual(canvasEvent("context_pack", { query: "  add a flag  ", path: "/secret/repo" }, env), {
    request: "add a flag",
    source: "cursor",
    tool: "context_pack",
  });
  assert.deepEqual(canvasEvent("review_verdict", { request: "ship the refund fix", base: "main" }, {}), {
    request: "ship the refund fix",
    source: "mcp",
    tool: "review_verdict",
  });
  assert.equal(canvasEvent("repo_inspect", { path: "." }, env), null);
  assert.equal(canvasEvent("repo_search", { query: "EventsController" }, env), null, "a symbol search is not a change request");
  assert.equal(canvasEvent("context_pack", {}, env), null);
  assert.equal(canvasEvent("context_pack", { query: "   " }, env), null);
  assert.equal(canvasEvent("review_gate", { request: 42 }, env), null);

  const long = canvasEvent("context_pack", { query: "x".repeat(10_000) }, { OTITO_HOST: "h".repeat(100) });
  assert.equal(long?.request.length, 4000);
  assert.equal(long?.source.length, 32);
});

test("every request-bearing argument the tap reads exists on that MCP tool", () => {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  for (const [name, argument] of Object.entries(REQUEST_ARGUMENT)) {
    const tool = byName.get(name);
    assert.ok(tool, `the tap names a tool the server does not have: ${name}`);
    assert.ok(tool.inputSchema.properties?.[argument], `${name} has no "${argument}" argument`);
  }
});

test("forwardToCanvas posts the event, and a failing canvas never throws", async () => {
  const env = { OTITO_CANVAS_URL: "http://127.0.0.1:7801", OTITO_HOST: "vscode" };
  const sent = [];
  const ok = await forwardToCanvas(
    "model_route",
    { query: "fix the typo", path: "." },
    {
      env,
      fetchImpl: async (url, init) => {
        sent.push({ url: String(url), init });
        return /** @type {any} */ ({ ok: true });
      },
    },
  );
  assert.equal(ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "http://127.0.0.1:7801/ingest");
  assert.equal(sent[0].init.method, "POST");
  assert.deepEqual(JSON.parse(sent[0].init.body), { request: "fix the typo", source: "vscode", tool: "model_route" });

  assert.equal(forwardToCanvas("model_route", { query: "fix the typo" }, { env: {}, fetchImpl: async () => assert.fail("tap is off") }), null);
  assert.equal(await forwardToCanvas("context_pack", { query: "q" }, { env, fetchImpl: async () => Promise.reject(new Error("ECONNREFUSED")) }), false);
  assert.equal(
    forwardToCanvas(
      "context_pack",
      { query: "q" },
      {
        env,
        fetchImpl: () => {
          throw new Error("synchronous failure");
        },
      },
    ),
    null,
  );
});

test("an MCP tool call reaches a live canvas without waiting on it", async (t) => {
  const received = [];
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  // A canvas that records the event and then hangs: the JSON-RPC response
  // must not wait for it.
  const canvas = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      received.push({ path: req.url, body: JSON.parse(body) });
      held.then(() => res.end("{}"));
    });
  });
  await new Promise((resolve) => canvas.listen(0, "127.0.0.1", resolve));
  const { port } = /** @type {import('node:net').AddressInfo} */ (canvas.address());

  const saved = { url: process.env.OTITO_CANVAS_URL, host: process.env.OTITO_HOST };
  process.env.OTITO_CANVAS_URL = `http://127.0.0.1:${port}`;
  process.env.OTITO_HOST = "cursor";
  t.after(() => {
    release();
    canvas.close();
    for (const [key, value] of [
      ["OTITO_CANVAS_URL", saved.url],
      ["OTITO_HOST", saved.host],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "otito-canvas-tap-"));
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ name: "tap-fixture", scripts: { test: "node --test" } }));
  fs.mkdirSync(path.join(fixture, "src"));
  fs.writeFileSync(path.join(fixture, "src", "flags.js"), "export const quiet = false;\n");

  const input = new PassThrough();
  const output = new PassThrough();
  let text = "";
  output.setEncoding("utf8");
  output.on("data", (chunk) => {
    text += chunk;
  });
  const started = Date.now();
  const done = startMcpServer({ input, output });
  input.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "context_pack", arguments: { query: "add a quiet flag", path: fixture } } })}\n`,
  );
  input.end();
  await done;
  const elapsed = Date.now() - started;

  const response = JSON.parse(text.trim());
  assert.equal(response.result.isError, false, "the tool answered normally");
  assert.ok(elapsed < 900, `the response waited on the canvas (${elapsed}ms)`);

  // The send was started before dispatch; give the loopback round trip a moment.
  for (let i = 0; i < 50 && received.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(received.length, 1);
  assert.equal(received[0].path, "/ingest");
  assert.deepEqual(received[0].body, { request: "add a quiet flag", source: "cursor", tool: "context_pack" });
});
