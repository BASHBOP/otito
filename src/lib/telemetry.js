// Opt-in, local-only usage telemetry. One JSONL line is appended per CLI run and
// per MCP tool call to ~/.dev-context/usage.jsonl, but ONLY when the user has
// turned it on. The whole module is built to be invisible when off and harmless
// when on:
//
//   - off by default; gated by the `telemetry` config key or OTITO_TELEMETRY,
//     and forced off under CI unless OTITO_TELEMETRY explicitly opts in.
//   - the gate is resolved ONCE per process and cached, so the hot path never
//     re-reads config (no per-event loadConfig directory walk).
//   - appendEvent is best-effort: it swallows every error and NEVER writes to
//     stdout, so it can never corrupt --json output or the MCP JSON-RPC channel
//     and can never fail a command (the determinism firewall).
//   - wall-clock `ts`/`durationMs` live ONLY in this log and the derived
//     dashboard — they are never fed into a token estimate or a converge receipt.
//   - error text is reduced to a class/code (e.g. ENOENT), never the raw message,
//     so absolute paths and queries can never leak into the log.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";

export const TELEMETRY_SCHEMA_VERSION = 1;
const MAX_LOG_BYTES = 5 * 1024 * 1024; // rotate at 5MB to a single .1 generation
const MAX_ERROR_LEN = 60;

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let otitoVersion = "0.0.0";
try {
  otitoVersion = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")).version ?? "0.0.0";
} catch {
  // best-effort; version is cosmetic in the log
}

/**
 * Resolve the append-only log path. OTITO_TELEMETRY_PATH overrides (used by
 * tests and power users); otherwise it sits beside the catalog under ~/.dev-context.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function telemetryLogPath(env = process.env) {
  return path.resolve(env.OTITO_TELEMETRY_PATH ?? path.join(os.homedir(), ".dev-context", "usage.jsonl"));
}

/**
 * @param {string | undefined} value
 * @returns {boolean | undefined}
 */
function coerceBool(value) {
  if (value === "true" || value === "1" || value === "on") return true;
  if (value === "false" || value === "0" || value === "off") return false;
  return undefined;
}

/**
 * Resolve whether telemetry is enabled. Precedence: OTITO_TELEMETRY env wins;
 * under CI the default is OFF unless the env explicitly opts in; otherwise the
 * persisted `telemetry` config key. Pure given its inputs.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} cwd
 * @returns {boolean}
 */
function resolveEnabled(env, cwd) {
  const envBool = coerceBool(env.OTITO_TELEMETRY);
  // CI must never capture from an inherited user config; only an explicit
  // OTITO_TELEMETRY=1 turns it on there.
  if (env.CI) return envBool === true;
  if (envBool !== undefined) return envBool;
  try {
    return loadConfig({ cwd, env }).telemetry === true;
  } catch {
    return false;
  }
}

/** @type {{ enabled: boolean } | null} */
let _gate = null;

/**
 * Cached per-process gate. The first call resolves config; later calls are free.
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string, fresh?: boolean }} [opts]
 * @returns {boolean}
 */
export function isTelemetryEnabled(opts = {}) {
  if (_gate && !opts.fresh) return _gate.enabled;
  const enabled = resolveEnabled(opts.env ?? process.env, opts.cwd ?? process.cwd());
  _gate = { enabled };
  return enabled;
}

/** Test seam: drop the cached gate (and any pending signals). */
export function resetTelemetryCache() {
  _gate = null;
  _pendingSignals = null;
}

/**
 * Reduce an error to a non-identifying class/code token — never the message,
 * which routinely embeds absolute paths, refs, or queries.
 * @param {unknown} error
 * @returns {string}
 */
export function redactError(error) {
  if (!error) return "Error";
  // Node fs/system errors carry a stable .code (ENOENT, EACCES, ...).
  const code = /** @type {{ code?: unknown }} */ (error).code;
  if (typeof code === "string" && code) return code.slice(0, MAX_ERROR_LEN);
  if (typeof code === "number") return `code:${code}`;
  const name = error instanceof Error ? error.constructor.name : typeof error;
  // McpProtocolError exposes a numeric JSON-RPC code worth keeping.
  const rpc = /** @type {{ code?: unknown }} */ (error).code;
  return (typeof rpc === "number" ? `${name}:${rpc}` : name).slice(0, MAX_ERROR_LEN);
}

/**
 * Pull the value signals a command produced off its result data, with no
 * recompute. Returns null when the data carries none (e.g. a code map).
 * @param {any} data
 * @returns {Record<string, any> | null}
 */
export function extractSignals(data) {
  if (!data || typeof data !== "object") return null;
  /** @type {Record<string, any>} */
  const s = {};
  if (data.tokenEstimate && typeof data.tokenEstimate.fullJson === "number") s.tokenEstimate = data.tokenEstimate.fullJson;
  if (typeof data.verdict === "string") s.verdict = data.verdict;
  if (typeof data.confidence === "number") s.confidence = data.confidence;
  if (typeof data.ax === "number") s.ax = data.ax;
  if (typeof data.convergence === "number") s.convergence = data.convergence;
  if (typeof data.band === "string") s.band = data.band;
  if (data.receipt && typeof data.receipt.id === "string") s.receiptId = data.receipt.id;
  if (data.validation && typeof data.validation.verdict === "string") s.validationVerdict = data.validation.verdict;
  if (data.totals && typeof data.totals.savedTokens === "number") s.savedTokens = data.totals.savedTokens;
  if (data.totals && typeof data.totals.savedPct === "number") s.savedPct = data.totals.savedPct;
  if (typeof data.passed === "boolean") s.evalPassed = data.passed;
  return Object.keys(s).length ? s : null;
}

/** @type {Record<string, any> | null} */
let _pendingSignals = null;

/**
 * Stash the signals from a CLI command's result so main()'s recorder can attach
 * them without threading a return value through every handler branch. One-shot:
 * takePendingSignals clears it. (MCP reads result.data directly instead.)
 * @param {any} data
 */
export function noteResult(data) {
  const s = extractSignals(data);
  if (s) _pendingSignals = s;
}

/** @returns {Record<string, any> | null} */
export function takePendingSignals() {
  const s = _pendingSignals;
  _pendingSignals = null;
  return s;
}

/**
 * Append one usage event, best-effort. Short-circuits when telemetry is off.
 * Stamps the envelope (schema version, wall-clock ts, otito/node version, and
 * a non-reversible repo group key). NEVER throws, NEVER writes stdout.
 * @param {Record<string, any>} event
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string }} [opts]
 * @returns {void}
 */
export function appendEvent(event, opts = {}) {
  try {
    const env = opts.env ?? process.env;
    if (!isTelemetryEnabled({ env, cwd: opts.cwd })) return;

    const repoRoot = event.repoRoot;
    const record = {
      v: TELEMETRY_SCHEMA_VERSION,
      ts: Date.now(),
      surface: event.surface,
      cmd: event.cmd,
      requested: event.requested ?? null,
      argsShape: event.argsShape ?? null,
      outcome: event.outcome ?? "ok",
      error: event.error ?? null,
      durationMs: typeof event.durationMs === "number" ? Math.round(event.durationMs) : null,
      repo: repoRoot ? crypto.createHash("sha256").update(String(repoRoot)).digest("hex").slice(0, 12) : null,
      otitoVersion,
      node: process.version,
      signals: event.signals ?? null,
    };

    const logPath = telemetryLogPath(env);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });

    // Single-generation rotation so the log can never grow without bound.
    try {
      if (fs.statSync(logPath).size > MAX_LOG_BYTES) fs.renameSync(logPath, `${logPath}.1`);
    } catch {
      // no existing log, or rotation raced another process — either is fine
    }

    // O_APPEND + one writeSync keeps small lines best-effort atomic across the
    // CLI and a concurrent MCP server writing the same file.
    const fd = fs.openSync(logPath, "a");
    try {
      fs.writeSync(fd, `${JSON.stringify(record)}\n`);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Telemetry must never break a command or pollute output.
  }
}

/**
 * Read all usage events from the log (and its rotated .1). Tolerant of torn or
 * unparseable lines (counted, not thrown) and of records from a newer schema
 * major (skipped, counted) so a downgrade never crashes the reader.
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {{ events: Record<string, any>[], skipped: number, skippedNewerSchema: number, path: string }}
 */
export function readTelemetryLog(opts = {}) {
  const env = opts.env ?? process.env;
  const logPath = telemetryLogPath(env);
  /** @type {Record<string, any>[]} */
  const events = [];
  let skipped = 0;
  let skippedNewerSchema = 0;

  for (const file of [`${logPath}.1`, logPath]) {
    let raw;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue; // file may not exist
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        skipped += 1;
        continue;
      }
      if (typeof event?.v === "number" && event.v > TELEMETRY_SCHEMA_VERSION) {
        skippedNewerSchema += 1;
        continue;
      }
      events.push(event);
    }
  }
  return { events, skipped, skippedNewerSchema, path: logPath };
}

/**
 * Delete the usage log and its rotated generation. Best-effort.
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {{ removed: string[], path: string }}
 */
export function clearTelemetryLog(opts = {}) {
  const env = opts.env ?? process.env;
  const logPath = telemetryLogPath(env);
  /** @type {string[]} */
  const removed = [];
  for (const file of [logPath, `${logPath}.1`]) {
    try {
      fs.rmSync(file);
      removed.push(file);
    } catch {
      // not present — nothing to remove
    }
  }
  return { removed, path: logPath };
}

/**
 * Snapshot of the telemetry state for `otito telemetry status`.
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string }} [opts]
 * @returns {{ enabled: boolean, path: string, exists: boolean, sizeBytes: number, events: number }}
 */
export function telemetryStatus(opts = {}) {
  const env = opts.env ?? process.env;
  const logPath = telemetryLogPath(env);
  let sizeBytes = 0;
  let exists = false;
  try {
    sizeBytes = fs.statSync(logPath).size;
    exists = true;
  } catch {
    // no log yet
  }
  const { events } = readTelemetryLog({ env });
  return {
    enabled: isTelemetryEnabled({ env, cwd: opts.cwd, fresh: true }),
    path: logPath,
    exists,
    sizeBytes,
    events: events.length,
  };
}
