#!/usr/bin/env node
// A Claude Code `UserPromptSubmit` hook that routes a request before it is
// worked on, so the tier is decided every time rather than whenever the model
// happens to remember the skill.
//
// What this can and cannot do, because the difference is the whole design:
//
//   - It CANNOT change the model this session runs on. No hook can. The docs
//     are explicit: `PreModelSwitch` may block a switch and `PostModelSwitch`
//     is read-only, and no hook output carries a model. A session cannot even
//     re-price itself through the app's own tooling.
//   - It CAN make the tier arrive as context, every time, before any work.
//   - It CAN name the model id a SUBAGENT should be launched on, and that is
//     real actuation: the Task/Agent tool takes a model, so delegated work
//     genuinely runs on the routed tier.
//
// So the hook advises the session and binds the subagent. It never claims the
// session was switched, which is the anti-pattern the model-router skill calls
// out by name. It also keeps what it decided, one line per routed prompt in a
// local log, because a tier printed as context is gone when the turn ends and
// a router can only ever be graded against decisions that were kept.
//
// It must never break a prompt. Every failure path is silent and exits 0: a
// router that can swallow a user's request is worse than no router.

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** This checkout's CLI, so the hook works whatever directory it routes. */
const CLI = path.resolve(HERE, "..", "..", "src", "cli.js");

/** Hard ceiling on the routing call. A slow repo must not stall a prompt. */
export const ROUTE_TIMEOUT_MS = 6000;

/** A `git rev-parse` that takes longer than this is not worth the head. */
const GIT_TIMEOUT_MS = 1500;

/**
 * Where the hook keeps what it decided. The tier printed as context is gone
 * when the turn ends; this file is the only record that a request was routed
 * and how, which is what any later grading of the router has to join to. It
 * never leaves the machine and never holds the prompt, only its hash.
 * `OTITO_ROUTE_LOG` names another file; `off` keeps nothing.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
export function routeLogPath(env = process.env) {
  const raw = env.OTITO_ROUTE_LOG;
  if (raw !== undefined && /^(off|0|false|none)$/i.test(raw.trim())) return null;
  return path.resolve(raw && raw.trim() ? raw.trim() : path.join(os.homedir(), ".otito", "route-decisions.jsonl"));
}

/**
 * The head and branch at prompt time, best effort. The head is what a later
 * commit join keys on: the request's change is the next commit on this branch
 * whose first parent is this head.
 * @param {string} cwd
 * @returns {{ head: string|null, branch: string|null }}
 */
export function gitStateAt(cwd) {
  const read = (/** @type {string[]} */ args) => {
    try {
      const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: GIT_TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] });
      const out = result.status === 0 ? result.stdout.trim() : "";
      return out || null;
    } catch {
      return null;
    }
  };
  return { head: read(["rev-parse", "--short=12", "HEAD"]), branch: read(["symbolic-ref", "--short", "-q", "HEAD"]) };
}

/**
 * One line of the decision log: everything `otito regret --rescore` reads to
 * re-tier a request (signals and the answers exactly as scored), the tier each
 * half gave, the session it belongs to, and where the repository was. Pure,
 * so it can be tested without a hook run.
 * @param {{ session_id?: string, cwd?: string, prompt?: string }} input
 * @param {any} route the `otito route --json` payload
 * @param {{ head?: string|null, branch?: string|null }} [git]
 */
export function decisionRecord(input, route, git = {}) {
  const prompt = String(input.prompt ?? "");
  const source = route?.model?.source === "jev" ? "jev" : "offline";
  const tiers = { deterministic: route?.deterministic?.tier ?? null, [source]: route?.tier ?? null };
  const routes = { deterministic: route?.deterministic?.route ?? null, [source]: route?.scoring?.route ?? null };
  const signals = route?.signals ?? {};
  return {
    v: 1,
    ts: new Date().toISOString(),
    host: "claude-code",
    sessionId: input.session_id ?? null,
    repo: route?.repo?.name ?? null,
    root: route?.repo?.root ?? input.cwd ?? null,
    branch: git.branch ?? null,
    head: git.head ?? null,
    promptHash: crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 16),
    promptChars: prompt.length,
    tier: route?.tier ?? null,
    hostModel: route?.hostModel ?? null,
    tiers,
    routes,
    signals: {
      ax: signals.ax ?? null,
      containment: signals.containment ?? null,
      candidates: signals.candidates ?? null,
      riskPaths: signals.riskPaths ?? [],
    },
    model: { source, name: route?.model?.model ?? null, fallbackReason: route?.model?.fallbackReason ?? null },
    answers: route?.model?.answers ?? null,
    modelRouteEngineVersion: route?.modelRouteEngineVersion ?? null,
  };
}

/**
 * Append one record. Best effort: a log that cannot be written costs the
 * record, never the prompt.
 * @param {Record<string, any>} record
 * @param {string|null} logPath
 * @returns {boolean}
 */
export function appendDecision(record, logPath) {
  if (!logPath) return false;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prompts that are turn-taking rather than work. Routing these would spend
 * seconds of latency to score the word "ok".
 */
const CONVERSATIONAL =
  /^(y|n|ok(ay)?|yes|no|yep|yeah|nope|sure|thanks|thank you|ta|cheers|go|go on|go ahead|continue|carry on|keep going|do it|please|stop|wait|hold on|nvm|never mind|undo|same|agreed|sounds good|lgtm|ship it)\b[\s.!?]*$/i;

/**
 * Whether a prompt is worth a routing call.
 *
 * Deliberately permissive: a request that is skipped costs nothing but a
 * missing hint, while a request that is routed costs seconds of latency. So
 * only clearly non-work prompts are filtered, and anything ambiguous routes.
 *
 * @param {string} prompt
 * @returns {boolean}
 */
export function isRoutable(prompt) {
  const trimmed = (prompt ?? "").trim();
  if (!trimmed) return false;
  // A slash command is handled by its own skill and is not a coding request.
  if (trimmed.startsWith("/")) return false;
  if (CONVERSATIONAL.test(trimmed)) return false;
  // Very short and not a sentence: "hi", "?", "again".
  if (trimmed.length < 12 && trimmed.split(/\s+/).length < 3) return false;
  return true;
}

/**
 * Whether this hook invocation should route at all.
 *
 * A subagent is skipped for two reasons: it was launched on a tier that was
 * already chosen for it, so re-routing would second-guess its own caller, and
 * a subagent that routes could launch a subagent, which is a loop nobody asked
 * for.
 *
 * @param {{hook_event_name?: string, prompt?: string, cwd?: string, agent_id?: string}} input
 * @returns {boolean}
 */
export function shouldRoute(input) {
  if (!input || typeof input !== "object") return false;
  if (input.hook_event_name && input.hook_event_name !== "UserPromptSubmit") return false;
  if (input.agent_id) return false;
  if (!input.cwd) return false;
  return isRoutable(input.prompt ?? "");
}

/**
 * The line a reader sees, and the instruction a model acts on.
 *
 * The wording is careful about two things. It says "recommends" rather than
 * "switched", because nothing here switched anything. And it asks for a
 * subagent only when delegating is already on the table, so a routed tier
 * cannot turn a one-line answer into a spawned agent.
 *
 * @param {{tier: string, hostModel?: string, scoring?: {route?: number}, signals?: {ax?: number}, model?: {read?: any}}} route
 * @returns {string}
 */
export function formatContext(route) {
  const score = route?.scoring?.route;
  const ax = route?.signals?.ax;
  const detail = [score === undefined ? null : `route ${score}`, ax === undefined ? null : `AX ${ax}`].filter(Boolean).join(", ");

  const lines = [
    `otito routed this request: tier **${route.tier}**${route.hostModel ? ` (${route.hostModel})` : ""}${detail ? ` — ${detail}` : ""}.`,
    "",
    "This is a recommendation, not a switch: a hook cannot change the model this session runs on, and this session cannot re-price its own turns. Do not say the model was changed.",
  ];

  // The request read rides the same route call. Only answers that cleared
  // their confidence floor are worth a line; an unsure one would be noise.
  const read = route?.model?.read;
  const readParts = [];
  if (read?.intent?.accepted) readParts.push(`intent **${read.intent.choice}** (${read.intent.confidence})`);
  if (read?.capability?.accepted && read.capability.choice !== "none") {
    readParts.push(`otito tool **${read.capability.choice}** (${read.capability.confidence})`);
  }
  if (readParts.length) lines.push("", `Request read (TypeSafe Jev, advisory): ${readParts.join(", ")}.`);

  if (route.hostModel) {
    lines.push(
      "",
      `If you delegate any part of this request to a subagent, launch it on \`${route.hostModel}\`. Do not spawn a subagent you would not otherwise have used just to reach that tier.`,
    );
  }

  return lines.join("\n");
}

/**
 * Run `otito route` for one request.
 * @param {string} cwd
 * @param {string} prompt
 * @returns {Promise<any|null>} the route payload, or null on any failure
 */
export function routeRequest(cwd, prompt) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (/** @type {any} */ value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let child;
    try {
      child = spawn(process.execPath, [CLI, "route", cwd, prompt, "--host", "claude-code", "--json"], {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return done(null);
    }

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done(null);
    }, ROUTE_TIMEOUT_MS);

    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      done(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return done(null);
      try {
        const parsed = JSON.parse(out);
        // A route with no evidence behind it is not worth printing; the router
        // itself says so through `scoring.evidence.sufficient`.
        if (!parsed?.tier) return done(null);
        done(parsed);
      } catch {
        done(null);
      }
    });
  });
}

/** Read all of stdin, or "" if nothing arrives. */
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

async function main() {
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    return;
  }

  if (!shouldRoute(input)) return;

  const route = await routeRequest(input.cwd, input.prompt);
  if (!route) return;

  // The decision outlives the turn only here.
  appendDecision(decisionRecord(input, route, gitStateAt(input.cwd)), routeLogPath());

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: formatContext(route),
      },
    }),
  );
}

// Only run when invoked as the hook, so the tests can import the pure parts.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(() => {
    // Silence is the contract: a failed router must not block a prompt.
  });
}
