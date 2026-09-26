import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { appendDecision, decisionRecord, formatContext, isRoutable, routeLogPath, shouldRoute } from "../scripts/hooks/route-prompt.mjs";

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "hooks", "route-prompt.mjs");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Run the hook as the harness runs it: JSON on stdin, JSON or nothing on
 * stdout. Returns the exit code and the raw stdout.
 * @param {unknown} input
 */
function runHook(input, { timeout = 30000, env: extra = {} } = {}) {
  return new Promise((resolve) => {
    // No vendor key reaches the hook: a test must not make a billed call
    // because of what the developer's shell exports. And no test writes the
    // developer's real decision log.
    const { TYPESAFE_API_KEY: _key, ...env } = process.env;
    const child = spawn(process.execPath, [HOOK], { stdio: ["pipe", "pipe", "pipe"], env: { ...env, OTITO_ROUTE_LOG: "off", ...extra } });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
    child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
  });
}

test("turn-taking prompts are not worth a routing call", () => {
  for (const prompt of ["ok", "OK.", "yes", "thanks", "sure", "go ahead", "continue", "ship it", "lgtm", "nvm", "hi", "?"]) {
    assert.equal(isRoutable(prompt), false, `${JSON.stringify(prompt)} should be skipped`);
  }
});

test("anything that could be work is routed, because a miss costs less than a false skip", () => {
  for (const prompt of [
    "fix the auth bug",
    "add a --quiet flag to the doctor command",
    "why is the gate failing on main?",
    "rename running to score",
    // Short, but three words of intent rather than an acknowledgement.
    "fix the typo",
  ]) {
    assert.equal(isRoutable(prompt), true, `${JSON.stringify(prompt)} should route`);
  }
});

test("a slash command belongs to its own skill, not to the router", () => {
  assert.equal(isRoutable("/code-review high"), false);
  assert.equal(isRoutable("/loop check the deploy"), false);
});

test("a subagent never routes, so a routed agent cannot launch another", () => {
  const base = { hook_event_name: "UserPromptSubmit", cwd: "/repo", prompt: "add a retry to the token refresh" };
  assert.equal(shouldRoute(base), true);
  assert.equal(shouldRoute({ ...base, agent_id: "agent_1" }), false);
});

test("a hook invocation without the fields it needs routes nothing", () => {
  assert.equal(shouldRoute(null), false);
  assert.equal(shouldRoute({}), false);
  assert.equal(shouldRoute({ hook_event_name: "PreToolUse", cwd: "/repo", prompt: "real work here" }), false);
  // No cwd means nothing to score the request against.
  assert.equal(shouldRoute({ hook_event_name: "UserPromptSubmit", prompt: "real work here" }), false);
});

test("the context names the subagent model but never claims a switch", () => {
  const context = formatContext({
    tier: "cheap",
    hostModel: "claude-haiku-4-5-20251001",
    scoring: { route: 88 },
    signals: { ax: 83 },
  });
  assert.match(context, /tier \*\*cheap\*\*/);
  assert.match(context, /claude-haiku-4-5-20251001/);
  assert.match(context, /route 88/);
  assert.match(context, /AX 83/);
  // The anti-pattern the skill names: claiming the host switched models when
  // it only recommended a tier.
  assert.match(context, /cannot change the model this session runs on/);
  assert.match(context, /Do not say the model was changed/);
  // And it must not manufacture delegation that was not already happening.
  assert.match(context, /Do not spawn a subagent you would not otherwise have used/);
});

test("an accepted request read rides along; an unsure one stays out", () => {
  const read = {
    intent: { choice: "fix", confidence: 0.93, accepted: true },
    capability: { choice: "change_impact", confidence: 0.61, accepted: true },
    relevance: [],
  };
  const context = formatContext({ tier: "mid", scoring: { route: 60 }, model: { read } });
  assert.match(context, /Request read \(TypeSafe Jev, advisory\): intent \*\*fix\*\* \(0\.93\), otito tool \*\*change_impact\*\* \(0\.61\)\./);

  const unsure = formatContext({
    tier: "mid",
    model: { read: { ...read, intent: { ...read.intent, accepted: false }, capability: { choice: "none", confidence: 0.9, accepted: true } } },
  });
  assert.doesNotMatch(unsure, /Request read/, "under the floor, or no tool, says nothing");
  assert.doesNotMatch(formatContext({ tier: "mid", model: { read: null } }), /Request read/);
});

test("a route with no host model still renders, without inventing a model id", () => {
  const context = formatContext({ tier: "mid", scoring: { route: 60 } });
  assert.match(context, /tier \*\*mid\*\*/);
  assert.doesNotMatch(context, /claude-/);
  assert.doesNotMatch(context, /subagent/);
});

test("malformed stdin exits 0 and emits nothing, because a router must not eat a prompt", async () => {
  const { code, out } = await runHook("this is not json");
  assert.equal(code, 0);
  assert.equal(out, "");
});

test("a skipped prompt exits 0 and emits nothing", async () => {
  const { code, out } = await runHook({ hook_event_name: "UserPromptSubmit", cwd: REPO, prompt: "ok" });
  assert.equal(code, 0);
  assert.equal(out, "");
});

test("a real request produces the documented hook output shape", async () => {
  const { code, out } = await runHook({
    hook_event_name: "UserPromptSubmit",
    cwd: REPO,
    prompt: "rename the variable running to score in model-route.js",
  });
  assert.equal(code, 0);
  assert.notEqual(out, "", "a routable request in a real repo should produce context");

  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  const context = parsed.hookSpecificOutput.additionalContext;
  assert.match(context, /otito routed this request/);
  // The host map is real, so the model id must be one of the three it holds.
  assert.match(context, /claude-(haiku-4-5-20251001|sonnet-5|opus-5)/);
});

test("the decision record keeps what a rescore reads and never the prompt", () => {
  const route = {
    tier: "mid",
    hostModel: "claude-sonnet-5",
    scoring: { route: 61, baseTier: "mid" },
    deterministic: { tier: "cheap", route: 80 },
    repo: { name: "otito", root: "/repo" },
    signals: { ax: 72, containment: 55, candidates: 4, riskPaths: ["configuration"], evidence: [{ path: "src/a.js" }] },
    model: { source: "offline", model: "offline-heuristic", answers: { specificity: { score: 0.6 }, blast_radius: { score: 0.4 }, novelty: { noul: 0.1 } } },
    modelRouteEngineVersion: "0.1.0",
  };
  const prompt = "rename running to score in model-route.js";
  const record = decisionRecord({ session_id: "s-1", cwd: "/repo", prompt }, route, { head: "abc123", branch: "develop" });
  assert.equal(record.v, 1);
  assert.equal(record.sessionId, "s-1");
  assert.equal(record.promptHash, crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 16));
  assert.equal(record.promptChars, prompt.length);
  assert.deepEqual(record.tiers, { deterministic: "cheap", offline: "mid" });
  assert.deepEqual(record.routes, { deterministic: 80, offline: 61 });
  assert.deepEqual(record.signals, { ax: 72, containment: 55, candidates: 4, riskPaths: ["configuration"] });
  assert.deepEqual(record.answers, route.model.answers);
  assert.equal(record.head, "abc123");
  assert.equal(record.hostModel, "claude-sonnet-5");
  assert.doesNotMatch(JSON.stringify(record), /rename running/);
  // A Jev-scored route files its tier under the model variant.
  const jev = decisionRecord({ prompt }, { ...route, model: { ...route.model, source: "jev", model: "jev-1.13.0" } });
  assert.deepEqual(jev.tiers, { deterministic: "cheap", jev: "mid" });
});

test("the decision log is on by default, movable, and off when asked", () => {
  assert.match(routeLogPath({}), /\.otito[\\/]route-decisions\.jsonl$/);
  assert.equal(routeLogPath({ OTITO_ROUTE_LOG: "off" }), null);
  assert.equal(routeLogPath({ OTITO_ROUTE_LOG: "0" }), null);
  assert.equal(routeLogPath({ OTITO_ROUTE_LOG: "/tmp/x.jsonl" }), path.resolve("/tmp/x.jsonl"));
  assert.equal(appendDecision({ v: 1 }, null), false, "off keeps nothing and says so");
});

test("a routed prompt leaves one line in the decision log, and a skipped one leaves none", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "route-log-"));
  const log = path.join(dir, "nested", "route-decisions.jsonl");
  const prompt = "rename the variable running to score in model-route.js";
  const { code } = await runHook({ hook_event_name: "UserPromptSubmit", session_id: "sess-42", cwd: REPO, prompt }, { env: { OTITO_ROUTE_LOG: log } });
  assert.equal(code, 0);
  const lines = fs.readFileSync(log, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.sessionId, "sess-42");
  assert.equal(record.promptHash, crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 16));
  assert.ok(["cheap", "mid", "premium"].includes(record.tier));
  assert.ok(["cheap", "mid", "premium"].includes(record.tiers.deterministic));
  assert.equal(typeof record.signals.ax, "number");
  assert.ok(record.answers?.specificity, "the answers ride along for a rescore");
  assert.match(record.head ?? "", /^[0-9a-f]{12}$/, "the head at prompt time is kept");
  assert.doesNotMatch(lines[0], /rename the variable/);

  await runHook({ hook_event_name: "UserPromptSubmit", session_id: "sess-42", cwd: REPO, prompt: "ok" }, { env: { OTITO_ROUTE_LOG: log } });
  assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 1, "a skipped prompt is not a decision");
  fs.rmSync(dir, { recursive: true, force: true });
});
