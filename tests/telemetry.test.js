import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  appendEvent,
  clearTelemetryLog,
  extractSignals,
  isTelemetryEnabled,
  readTelemetryLog,
  redactError,
  resetTelemetryCache,
  TELEMETRY_SCHEMA_VERSION,
} from "../src/lib/telemetry.js";
import { startMcpServer } from "../src/lib/mcp.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "src", "cli.js");

function tmpLog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "otito-telemetry-"));
  return path.join(dir, "usage.jsonl");
}

function on(logPath) {
  return { OTITO_TELEMETRY: "1", OTITO_TELEMETRY_PATH: logPath };
}

test("appendEvent writes nothing when telemetry is off", () => {
  resetTelemetryCache();
  const logPath = tmpLog();
  appendEvent({ surface: "cli", cmd: "ax" }, { env: { OTITO_TELEMETRY: "0", OTITO_TELEMETRY_PATH: logPath } });
  assert.equal(fs.existsSync(logPath), false, "no log file when disabled");
});

test("appendEvent writes one stamped JSON line when on", () => {
  resetTelemetryCache();
  const logPath = tmpLog();
  appendEvent(
    {
      surface: "cli",
      cmd: "converge",
      argsShape: { positionals: 1, flags: ["base", "json"] },
      outcome: "ok",
      durationMs: 12.6,
      repoRoot: "/some/repo",
      signals: { convergence: 86 },
    },
    { env: on(logPath) },
  );

  const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.v, TELEMETRY_SCHEMA_VERSION);
  assert.equal(rec.surface, "cli");
  assert.equal(rec.cmd, "converge");
  assert.equal(rec.durationMs, 13, "duration is rounded");
  assert.equal(typeof rec.ts, "number");
  assert.equal(rec.signals.convergence, 86);
  assert.match(rec.repo, /^[0-9a-f]{12}$/, "repo is a 12-char hash, not the path");
  assert.equal(rec.repo.includes("/some/repo"), false, "raw path never stored");
});

test("CI forces telemetry off unless OTITO_TELEMETRY explicitly opts in", () => {
  resetTelemetryCache();
  assert.equal(isTelemetryEnabled({ env: { CI: "true" }, fresh: true }), false, "CI default is off");
  assert.equal(isTelemetryEnabled({ env: { CI: "true", OTITO_TELEMETRY: "1" }, fresh: true }), true, "explicit opt-in wins in CI");
  assert.equal(isTelemetryEnabled({ env: { OTITO_TELEMETRY: "1" }, fresh: true }), true, "env opt-in outside CI");
  assert.equal(isTelemetryEnabled({ env: { OTITO_TELEMETRY: "0" }, fresh: true }), false, "env opt-out");
});

test("redactError keeps a code/class, never the message", () => {
  const enoent = Object.assign(new Error("ENOENT: no such file, open '/Users/secret/path'"), { code: "ENOENT" });
  assert.equal(redactError(enoent), "ENOENT");
  assert.equal(redactError(new TypeError("boom at /Users/x")), "TypeError");
  const rpc = Object.assign(new Error("bad"), { code: -32602 });
  assert.equal(redactError(rpc), "code:-32602");
  assert.equal(redactError(null), "Error");
});

test("extractSignals pulls value signals and ignores empty data", () => {
  assert.equal(extractSignals(null), null);
  assert.equal(extractSignals({ files: [] }), null);
  const s = extractSignals({ convergence: 80, band: "aligned", receipt: { id: "rcpt_abc" }, tokenEstimate: { fullJson: 1500 }, verdict: "PASS" });
  assert.equal(s.convergence, 80);
  assert.equal(s.receiptId, "rcpt_abc");
  assert.equal(s.tokenEstimate, 1500);
  assert.equal(s.verdict, "PASS");
});

test("readTelemetryLog tolerates torn lines and skips newer schema versions", () => {
  resetTelemetryCache();
  const logPath = tmpLog();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, [JSON.stringify({ v: 1, cmd: "ax" }), "{ this is a torn line", JSON.stringify({ v: 999, cmd: "from-the-future" }), ""].join("\n"));
  const { events, skipped, skippedNewerSchema } = readTelemetryLog({ env: { OTITO_TELEMETRY_PATH: logPath } });
  assert.equal(events.length, 1);
  assert.equal(events[0].cmd, "ax");
  assert.equal(skipped, 1, "the torn line is skipped, not thrown");
  assert.equal(skippedNewerSchema, 1, "newer-schema records are skipped");
});

test("clearTelemetryLog removes the log and its rotated generation", () => {
  const logPath = tmpLog();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, "x\n");
  fs.writeFileSync(`${logPath}.1`, "y\n");
  const { removed } = clearTelemetryLog({ env: { OTITO_TELEMETRY_PATH: logPath } });
  assert.equal(removed.length, 2);
  assert.equal(fs.existsSync(logPath), false);
  assert.equal(fs.existsSync(`${logPath}.1`), false);
});

// The determinism firewall: telemetry is a side file, never a change to output.
test("CLI --json stdout is byte-identical with telemetry on vs off", () => {
  const args = ["repo", here, "--json"];
  const offLog = tmpLog();
  const onLog = tmpLog();
  const off = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, OTITO_TELEMETRY: "0", OTITO_TELEMETRY_PATH: offLog },
  });
  const onRun = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, OTITO_TELEMETRY: "1", OTITO_TELEMETRY_PATH: onLog },
  });
  assert.equal(onRun.stdout, off.stdout, "stdout must not change when telemetry is enabled");
  assert.equal(fs.existsSync(offLog), false, "off run writes no log");
  assert.equal(fs.existsSync(onLog), true, "on run writes a log (side channel only)");
});

async function runMcp(messages, env) {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames = [];
  let buffer = "";
  output.setEncoding("utf8");
  output.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines.filter(Boolean)) frames.push(line);
  });
  const saved = { t: process.env.OTITO_TELEMETRY, p: process.env.OTITO_TELEMETRY_PATH };
  Object.assign(process.env, env);
  resetTelemetryCache();
  try {
    const done = startMcpServer({ input, output });
    for (const m of messages) input.write(`${JSON.stringify(m)}\n`);
    input.end();
    await done;
  } finally {
    process.env.OTITO_TELEMETRY = saved.t;
    process.env.OTITO_TELEMETRY_PATH = saved.p;
    resetTelemetryCache();
  }
  if (buffer.trim()) frames.push(buffer.trim());
  return frames;
}

test("MCP JSON-RPC frames are byte-identical with telemetry on vs off, and the on run records an event", async () => {
  const calls = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "repo_inspect", arguments: { path: here } } },
  ];
  const offLog = tmpLog();
  const onLog = tmpLog();
  const offFrames = await runMcp(calls, { OTITO_TELEMETRY: "0", OTITO_TELEMETRY_PATH: offLog });
  const onFrames = await runMcp(calls, { OTITO_TELEMETRY: "1", OTITO_TELEMETRY_PATH: onLog });

  assert.deepEqual(onFrames, offFrames, "the JSON-RPC channel must be unchanged by telemetry");
  assert.equal(fs.existsSync(offLog), false, "off run writes no log");
  const { events } = readTelemetryLog({ env: { OTITO_TELEMETRY_PATH: onLog } });
  const toolEvent = events.find((e) => e.surface === "mcp" && e.cmd === "repo_inspect");
  assert.ok(toolEvent, "the tool call was recorded on the MCP surface");
  assert.equal(typeof toolEvent.durationMs, "number");
});
