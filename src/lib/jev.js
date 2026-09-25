// A System One client, and the request-read questions otito asks it.
//
// A System One model (TypeSafe's Jev) takes a state and typed questions and
// returns typed answers with probabilities. otito asks two kinds of question
// and keeps them apart:
//
//   - the ROUTE questions in model-route.js, whose answers the router scores;
//   - the READ questions here: what kind of work a request asks for, which
//     otito tool answers it, and whether each candidate file matters. Their
//     answers are reported, and applied only where a caller opted in and the
//     answer clears its gate.
//
// Neither kind reaches the merge gate. A failed, unreachable or unkeyed call
// costs a read, never a verdict. See docs/18-model-routing.

import { readFileSync } from "node:fs";

let otitoVersion = "0.0.0";
try {
  otitoVersion = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version ?? "0.0.0";
} catch {
  // best-effort; the version only labels the client
}

/**
 * Every call identifies its client, and only its client: the tag carries
 * Otito's name and version, never a user, a repository or a key.
 */
export const JEV_USER_AGENT = `otito/${otitoVersion}`;

export const JEV_API_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
/** A hung vendor call must not hang the tool that made it. */
export const JEV_TIMEOUT_MS = 10_000;

/** Jev bills input tokens only, at $0.042 per million. */
export const JEV_PER_MTOK = 0.042;

/**
 * Cost of one call, in USD, from the tokens the rate actually covers.
 *
 * Null means "not measured", which is not the same as zero: a call that billed
 * no input tokens cost nothing and is entitled to say so. Anything that is not
 * a finite, non-negative count is not a measurement and prices to null rather
 * than to a number nobody can trace.
 *
 * @param {number|null|undefined} inputTokens tokens JEV_PER_MTOK covers
 * @returns {number|null}
 */
export function priceJevCall(inputTokens) {
  if (typeof inputTokens !== "number" || !Number.isFinite(inputTokens) || inputTokens < 0) return null;
  return Number(((inputTokens * JEV_PER_MTOK) / 1e6).toFixed(6));
}

/**
 * @typedef {object} SystemOneReply
 * @property {"jev"} source
 * @property {string} model
 * @property {number|null} tokens
 * @property {number|null} billableTokens tokens JEV_PER_MTOK covers; null when the response reported no input count
 * @property {"input"|"total"|null} tokenKind which quantity `tokens` holds, so no surface has to guess
 * @property {number} latencyMs
 * @property {Record<string, any>} answers
 */

/**
 * Ask every question against one state in a single call.
 * @param {unknown} state
 * @param {Record<string, unknown>} questions
 * @param {{ apiKey?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<SystemOneReply>}
 */
export async function askSystemOne(state, questions, options = {}) {
  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not set");
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  const started = Date.now();
  const response = await doFetch(JEV_API_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "user-agent": JEV_USER_AGENT },
    body: JSON.stringify({ state, model: JEV_MODEL, questions }),
    signal: globalThis.AbortSignal.timeout(options.timeoutMs ?? JEV_TIMEOUT_MS),
  });
  const latencyMs = Date.now() - started;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`TypeSafe API ${response.status}: ${body.slice(0, 200)}`);
  }

  const payload = /** @type {any} */ (await response.json());

  // Report the count the response gave, and remember which quantity it is.
  // JEV_PER_MTOK covers input tokens; a `total_tokens` figure also contains
  // output, which this rate does not price. Collapsing the two into one number
  // used to bill output at the input rate silently, so the two stay apart: the
  // count is still shown, and only an input count is priced.
  const usage = payload.usage ?? {};
  const count = (/** @type {any} */ value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const inputTokens = count(usage.input_tokens);
  const totalTokens = count(usage.total_tokens) ?? count(usage.tokens);

  return {
    source: "jev",
    model: payload.model ?? JEV_MODEL,
    tokens: inputTokens ?? totalTokens,
    billableTokens: inputTokens,
    tokenKind: inputTokens !== null ? "input" : totalTokens !== null ? "total" : null,
    latencyMs,
    answers: payload.answers ?? {},
  };
}

/**
 * What kind of work a request asks for. The keys are what a context pack
 * reports as `intent.action`, so an accepted answer drops straight in.
 */
export const INTENTS = {
  add: "Add a capability that does not exist yet: a new feature, command, flag, endpoint or tool.",
  fix: "Fix behaviour that is known to be wrong, where the request says what is broken.",
  change: "Change existing behaviour, configuration, copy or wording that works as built.",
  refactor: "Restructure, move or rename code without changing what it does.",
  test: "Add, repair or extend tests without changing the code under test.",
  debug: "Investigate a failure or symptom whose cause is not yet known.",
  review: "Review, gate or assess a change, diff or pull request rather than write one.",
  explain: "Explain, explore or answer a question about the code, with no edit asked for.",
};

/**
 * Which otito tool answers a request. The keys other than `none` must match
 * the MCP tool catalog; a test holds the two in parity. Kept here rather than
 * read from mcp.js because mcp.js imports the router, and the router imports
 * this file.
 */
export const CAPABILITIES = {
  context_pack: "Gather the files, tests and commands to read before planning or editing a change.",
  change_impact: "Rank which files own a change and what else it could break.",
  agent_experience: "Score how cheap and safe a change would be for an agent to make here.",
  model_route: "Decide how capable a model a coding task needs before starting it.",
  convergence_score: "Measure whether a finished diff did what was asked, and only that.",
  review_gate: "Decide whether a change or pull request is ready to merge.",
  review_verdict: "Produce a full review verdict for a change: impact, review context and gate together.",
  review_context: "Collect the review context and comments for a diff or pull request, with no verdict.",
  repo_search: "Find a file, symbol, route or domain across indexed repositories.",
  repo_map: "Map a repository's files, imports, routes and domains.",
  repo_inspect: "Describe a repository's languages, scripts, package managers and entrypoints.",
  repo_harness: "List the setup, validation and run commands for a repository.",
  repo_index: "Index repositories into the local catalog so they can be searched.",
  workspace_report: "Report across several related repositories at once.",
  none: "None of these: the request is not about this repository's code, its changes or their review.",
};

/**
 * A Choice answer is accepted at or above this confidence. TypeSafe's guidance
 * is not to act below 0.5; relabelling an intent or naming a tool is low
 * stakes and reversible, so the floor sits there rather than higher.
 */
export const CHOICE_FLOOR = 0.5;

/**
 * A candidate file is demoted only on a strong no. Dropping a file from an
 * agent's context costs more than keeping a weak one, so a doubtful answer
 * keeps the file.
 */
export const DEMOTE_BELOW = 0.2;

/** Files per call. One Noul each; beyond this the state stops being a summary. */
export const MAX_RELEVANCE_FILES = 24;

/**
 * @typedef {{ path: string, kind?: string, reasons?: string[], why?: string[], label?: string }} ReadFile
 */

/**
 * The read questions for one request. Relevance keys are positional because a
 * path may hold characters a question id should not.
 * @param {{ files?: ReadFile[], intent?: boolean, capability?: boolean }} [options]
 * @returns {Record<string, unknown>}
 */
export function readQuestions({ files = [], intent = true, capability = true } = {}) {
  /** @type {Record<string, unknown>} */
  const questions = {};
  if (intent) {
    questions.read_intent = {
      type: "choice",
      instructions: "What kind of work does this request ask for?",
      criteria: INTENTS,
    };
  }
  if (capability) {
    questions.read_capability = {
      type: "choice",
      instructions: "Which one of these repository tools most directly answers this request?",
      criteria: CAPABILITIES,
    };
  }
  files.slice(0, MAX_RELEVANCE_FILES).forEach((file, index) => {
    questions[`read_file_${index}`] = {
      type: "noul",
      // `label` disambiguates two repos that share a path in a multi-repo pack;
      // it falls back to the bare path for the common single-repo case.
      instructions: `Would carrying out this request require reading or editing the file ${file.label ?? file.path}?`,
      criteria: {
        true: "A developer doing this work would open this file: it owns, defines, tests or configures what the request is about.",
        false: "This file can be left unread: it only shares a word, a domain or a directory with the request.",
      },
    };
  });
  return questions;
}

/**
 * @typedef {{ choice: string, confidence: number|null, accepted: boolean, probabilities: Record<string, number> }} ChoiceRead
 * @typedef {{ path: string, relevance: number|null }} RelevanceRead
 * @typedef {{ intent: ChoiceRead|null, capability: ChoiceRead|null, relevance: RelevanceRead[] }} RequestRead
 */

/**
 * @param {any} answer
 * @param {Record<string, string>} options
 * @returns {ChoiceRead|null}
 */
function readChoice(answer, options) {
  // `Object.hasOwn`, not `in`: `in` would accept inherited keys like
  // "constructor" or "toString" as valid choices and let them through as
  // accepted answers.
  if (!answer || typeof answer.choice !== "string" || !Object.hasOwn(options, answer.choice)) return null;
  const confidence = typeof answer.confidence === "number" && Number.isFinite(answer.confidence) ? round2(answer.confidence) : null;
  /** @type {Record<string, number>} */
  const probabilities = {};
  for (const [key, value] of Object.entries(answer.probabilities ?? {})) {
    if (typeof value === "number") probabilities[key] = round2(value);
  }
  return { choice: answer.choice, confidence, accepted: confidence !== null && confidence >= CHOICE_FLOOR, probabilities };
}

/**
 * Turn the read answers into what a caller can act on. Anything missing or
 * malformed reads as null, never as a guess.
 * @param {Record<string, any>} answers
 * @param {ReadFile[]} [files]
 * @returns {RequestRead}
 */
export function interpretRead(answers, files = []) {
  return {
    intent: readChoice(answers?.read_intent, INTENTS),
    capability: readChoice(answers?.read_capability, CAPABILITIES),
    relevance: files.slice(0, MAX_RELEVANCE_FILES).map((file, index) => {
      const value = answers?.[`read_file_${index}`]?.noul;
      return { path: file.path, relevance: typeof value === "number" && Number.isFinite(value) ? round2(value) : null };
    }),
  };
}

/**
 * Split a reply into the answers a set of questions asked for and the rest.
 * @param {Record<string, any>} answers
 * @param {Record<string, unknown>} questions
 */
export function pickAnswers(answers, questions) {
  return Object.fromEntries(Object.keys(questions).flatMap((key) => (key in (answers ?? {}) ? [[key, answers[key]]] : [])));
}

const round2 = (/** @type {number} */ value) => Number(value.toFixed(2));
