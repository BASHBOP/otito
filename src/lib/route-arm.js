// Enforce mode for model routing: which requests are made to follow the
// router, and the Agent-tool model a routed tier maps to. Shared by the
// Claude Code hook and `otito route`, so both assign the same arm to the same
// request.

import crypto from "node:crypto";

/** The Agent tool's model aliases, by tier. */
export const AGENT_MODEL = { cheap: "haiku", mid: "sonnet", premium: "opus" };

/**
 * Which arm a request falls in. `OTITO_ROUTE_MODE=delegate` turns the trial
 * on; `OTITO_ROUTE_DELEGATE_SHARE` (0 to 1, default 0.5) is the share of
 * requests put in the delegate arm. Assignment is by the prompt's hash, so it
 * is random across requests but the same prompt always lands in the same arm.
 * @param {string} prompt
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ mode: "advisory"|"delegate", arm: "advisory"|"delegate"|"control", share: number|null }}
 */
export function routeArm(prompt, env = process.env) {
  if (!/^delegate$/i.test(String(env.OTITO_ROUTE_MODE ?? "").trim())) return { mode: "advisory", arm: "advisory", share: null };
  const raw = Number(env.OTITO_ROUTE_DELEGATE_SHARE);
  const share = Number.isFinite(raw) && env.OTITO_ROUTE_DELEGATE_SHARE?.trim() ? Math.min(1, Math.max(0, raw)) : 0.5;
  const bucket = parseInt(crypto.createHash("sha256").update(`arm:${prompt}`).digest("hex").slice(0, 8), 16) / 0x100000000;
  return { mode: "delegate", arm: bucket < share ? "delegate" : "control", share };
}
