// Opt-in: show an MCP host's requests on a local Otito Realtime Canvas.
//
// The canvas is an observer, never a participant (see the otito-canvas
// README). Claude Code reaches it through a prompt hook; Cursor, VS Code,
// Codex and the other MCP hosts have no such hook, so without this tap their
// requests never appear on it.
//
// Off unless OTITO_CANVAS_URL is set in the MCP server's environment, which
// is a line in the host's MCP config, so the promise that otito makes no
// network call by default still holds. When it is on, the tap:
//
//   - sends the request text, the tool name and a host label, never a result,
//     a path argument or file contents;
//   - only sends to a loopback address, because the canvas has no
//     authentication and a request can describe unreleased work;
//   - never awaits, so it cannot delay or alter a JSON-RPC response.

/** The argument that carries a plain-English request, per tool. */
export const REQUEST_ARGUMENT = /** @type {Record<string, string>} */ ({
  context_pack: "query",
  change_impact: "query",
  agent_experience: "query",
  model_route: "query",
  convergence_score: "query",
  review_gate: "request",
  review_verdict: "request",
});

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
// Bounds a stuck loopback send without aborting one that is merely waiting for
// a CPU-bound tool dispatch to release the event loop so its bytes can flush.
const SEND_TIMEOUT_MS = 8000;
const MAX_REQUEST_CHARS = 4000;

/**
 * The canvas ingest URL, or null when the tap is off or the URL is not a
 * loopback http address.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {URL | null}
 */
export function canvasIngestUrl(env = process.env) {
  const raw = env.OTITO_CANVAS_URL;
  if (!raw || !raw.trim()) return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname)) return null;
  return new URL("/ingest", url);
}

/**
 * What the canvas is sent for one tool call, or null when the call carries no
 * request text worth showing.
 * @param {string} tool canonical tool name
 * @param {Record<string, unknown>} args
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ request: string, source: string, tool: string } | null}
 */
export function canvasEvent(tool, args, env = process.env) {
  const key = REQUEST_ARGUMENT[tool];
  if (!key) return null;
  const value = args?.[key];
  if (typeof value !== "string" || !value.trim()) return null;
  const host = (env.OTITO_HOST ?? "").trim();
  return {
    request: value.trim().slice(0, MAX_REQUEST_CHARS),
    // The canvas prefixes its own transport and keeps 32 characters.
    source: host ? host.slice(0, 32) : "mcp",
    tool,
  };
}

/**
 * Forward a tool call to the canvas, fire and forget. Returns the pending send
 * for tests, or null when nothing was sent. The promise never rejects.
 * @param {string} tool
 * @param {Record<string, unknown>} args
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<boolean> | null}
 */
export function forwardToCanvas(tool, args, options = {}) {
  try {
    const env = options.env ?? process.env;
    const url = canvasIngestUrl(env);
    if (!url) return null;
    const event = canvasEvent(tool, args, env);
    if (!event) return null;
    const doFetch = options.fetchImpl ?? globalThis.fetch;
    return doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      signal: globalThis.AbortSignal.timeout(SEND_TIMEOUT_MS),
    }).then(
      (response) => response.ok,
      () => false,
    );
  } catch {
    // A canvas that is down, slow or misconfigured must never reach the agent.
    return null;
  }
}
