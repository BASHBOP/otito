// repoctx convergence: a deterministic 0–100 measure of the distance between a
// stated task (intent) and the actual git diff (execution). It is the buildable
// core of the "prove software sanity" argument (docs/09-convergence-thesis):
// not a proof, a *measurement*, computed out-of-band where the agent cannot fake
// it — "the goal prompt read forward, the commit log read backward, and the
// convergence grade is the distance between the two."
//
// Convergence is a composition layer, not new analysis. generateImpact already
// turns the task into predicted owner files and, given a diff base, compares the
// prediction against the real diff (validateAgainstDiff). This module promotes
// that comparison from a three-value verdict into a score with named sub-scores
// and a recomputable receipt. Pure and deterministic for a given repo state.

import crypto from "node:crypto";
import path from "node:path";
import { generateImpact } from "./impact.js";
import { classifyPath, isSecretPath, RISK_FLAGS } from "./risk-paths.js";
import { runCommand } from "./tools.js";
import { estimateTokens } from "./tokens.js";

export const convergenceEngineVersion = "0.1.0";

// Sub-score weights. Coverage (did intent happen?) leads, scope discipline (did
// only intent happen?) is next, risk alignment (did drift land somewhere
// dangerous?) is the safety modifier. Kept as named constants so they can move
// into config.js later without touching the formula.
const WEIGHTS = { coverage: 0.45, scope: 0.35, riskAlignment: 0.2 };

// Per-file penalty applied to risk alignment for each *unrequested* changed file,
// scaled by the worst risk flag it carries. A drifted edit to a secret/auth/money
// path should tank the score; a drifted README barely moves it.
const RISK_WEIGHTS = {
  secret: 30,
  [RISK_FLAGS.authSecurity]: 25,
  [RISK_FLAGS.moneyFlow]: 25,
  [RISK_FLAGS.dataModel]: 15,
  [RISK_FLAGS.contract]: 15,
  [RISK_FLAGS.requestSurface]: 15,
  [RISK_FLAGS.configuration]: 10,
  default: 5,
};

/**
 * @param {string} query
 * @param {{ path?: string, base?: string, top?: number }} [options]
 * @returns {Record<string, any>}
 */
export function generateConvergence(query, options = {}) {
  const repoPath = options.path ?? ".";
  const top = options.top ?? 10;
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery) {
    throw new Error('converge requires a task, e.g. `repoctx converge "add Stripe refunds" --base origin/main`');
  }
  const base = String(options.base ?? "").trim();
  if (!base) {
    throw new Error('converge requires a --base git ref to diff against, e.g. `repoctx converge "<task>" --base origin/main`');
  }

  /** @type {any} */
  const impact = generateImpact(normalizedQuery, { path: repoPath, top, diffBase: base }).data;
  const validation = impact.validation;
  if (!validation) {
    throw new Error("converge could not produce a diff comparison; ensure the base ref is valid");
  }
  if (validation.ok === false) {
    throw new Error(validation.error ?? "converge failed to read the git diff");
  }

  const changedFiles = validation.changedFiles ?? [];
  const confirmedDirect = validation.confirmedDirect ?? [];
  const confirmedRelated = validation.confirmedRelated ?? [];
  const unconfirmedCandidates = validation.unconfirmedCandidates ?? [];
  const missedChangedFiles = validation.missedChangedFiles ?? [];

  const predictedDirect = confirmedDirect.length + unconfirmedCandidates.length;
  const grounded = predictedDirect > 0;

  // Coverage — did the intent actually happen? Share of predicted owner files
  // that were really changed. Ungrounded tasks (no prediction) are unmeasurable,
  // so coverage is 0 and a recommendation explains why.
  const coverage = grounded ? (100 * confirmedDirect.length) / predictedDirect : 0;

  // Scope discipline — did *only* the intent happen? Share of changed files that
  // the task anticipated (directly or as a related dependency). Missed changed
  // files are scope drift. An empty diff converges on nothing, so scope is 0.
  const onTask = confirmedDirect.length + confirmedRelated.length;
  const scope = changedFiles.length > 0 ? (100 * onTask) / changedFiles.length : 0;

  // Risk alignment — penalise drift by how dangerous the drifted file is.
  const riskyDrift = missedChangedFiles
    .map((/** @type {string} */ file) => ({ file, weight: riskWeightFor(file), flags: riskFlagsFor(file) }))
    .filter((/** @type {{ flags: string[] }} */ entry) => entry.flags.length > 0);
  const riskPenalty = missedChangedFiles.reduce((/** @type {number} */ sum, /** @type {string} */ file) => sum + riskWeightFor(file), 0);
  const riskAlignment = clamp(100 - riskPenalty, 0, 100);

  const convergence = Math.round(WEIGHTS.coverage * coverage + WEIGHTS.scope * scope + WEIGHTS.riskAlignment * riskAlignment);
  const band = bandFor(convergence);

  const commit = currentCommit(impact.repo?.root ?? repoPath);

  const drivers = {
    changedFiles: changedFiles.length,
    predictedDirect,
    confirmedDirect,
    confirmedRelated,
    unconfirmedCandidates,
    missedChangedFiles,
    grounded,
    riskyDrift,
  };

  /** @type {Record<string, any>} */
  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    convergenceEngineVersion,
    task: normalizedQuery,
    base,
    repo: { name: impact.repo?.name ?? path.basename(path.resolve(repoPath)), root: impact.repo?.root ?? path.resolve(repoPath) },
    convergence,
    band,
    subScores: {
      coverage: Math.round(coverage),
      scope: Math.round(scope),
      riskAlignment: Math.round(riskAlignment),
    },
    drivers,
    recommendations: buildRecommendations({ grounded, unconfirmedCandidates, missedChangedFiles, riskyDrift }),
    weights: WEIGHTS,
  };

  // Recomputable receipt — the video's "tamper-evident attestation". The hash
  // deliberately excludes generatedAt so anyone with the same repo state, task,
  // and engine version regenerates the SAME hash and can compare it to the one
  // stamped on the commit. Identity, not timestamp.
  data.receipt = makeReceipt({
    engine: convergenceEngineVersion,
    task: normalizedQuery,
    base,
    commit,
    convergence,
    subScores: data.subScores,
    changedFiles,
    confirmedDirect,
    confirmedRelated,
    unconfirmedCandidates,
    missedChangedFiles,
  });

  data.tokenEstimate = { fullJson: estimateTokens(data) };
  return data;
}

/**
 * Deterministic receipt over a canonical, timestamp-free payload. Same inputs →
 * same id, so a CI step (or a human) can recompute and verify it.
 * @param {Record<string, any>} payload
 * @returns {{ id: string, algorithm: string, commit: string|null, inputsHash: string }}
 */
export function makeReceipt(payload) {
  const canonical = {
    engine: payload.engine,
    task: payload.task,
    base: payload.base,
    commit: payload.commit ?? null,
    convergence: payload.convergence,
    subScores: payload.subScores,
    changedFiles: [...(payload.changedFiles ?? [])].sort(),
    confirmedDirect: [...(payload.confirmedDirect ?? [])].sort(),
    confirmedRelated: [...(payload.confirmedRelated ?? [])].sort(),
    unconfirmedCandidates: [...(payload.unconfirmedCandidates ?? [])].sort(),
    missedChangedFiles: [...(payload.missedChangedFiles ?? [])].sort(),
  };
  const inputsHash = crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return { id: `rcpt_${inputsHash.slice(0, 12)}`, algorithm: "sha256", commit: payload.commit ?? null, inputsHash };
}

/**
 * @param {string} root
 * @returns {string|null}
 */
function currentCommit(root) {
  const result = runCommand("git", ["rev-parse", "HEAD"], { cwd: root });
  if (!result.ok) return null;
  const sha = result.stdout.trim();
  return sha || null;
}

/**
 * @param {string} file
 * @returns {string[]}
 */
function riskFlagsFor(file) {
  const flags = classifyPath(file);
  if (isSecretPath(file)) flags.push("secret");
  return flags;
}

/**
 * Worst-case risk weight for a path: the highest weight among its risk flags,
 * or the default if it carries none.
 * @param {string} file
 * @returns {number}
 */
function riskWeightFor(file) {
  const flags = riskFlagsFor(file);
  if (flags.length === 0) return RISK_WEIGHTS.default;
  return Math.max(...flags.map((flag) => /** @type {Record<string, number>} */ (RISK_WEIGHTS)[flag] ?? RISK_WEIGHTS.default));
}

/**
 * @param {{ grounded: boolean, unconfirmedCandidates: string[], missedChangedFiles: string[], riskyDrift: {file: string}[] }} input
 * @returns {string[]}
 */
function buildRecommendations({ grounded, unconfirmedCandidates, missedChangedFiles, riskyDrift }) {
  /** @type {string[]} */
  const recs = [];
  if (!grounded) {
    recs.push("The task did not ground to any predicted owner files; rephrase it or run `repoctx impact` to check grounding before trusting this score.");
  }
  if (riskyDrift.length) {
    recs.push(
      `Drift touches risk-sensitive paths: ${formatList(riskyDrift.map((d) => d.file))} — these changes were not anticipated by the task and need explicit review.`,
    );
  }
  if (missedChangedFiles.length) {
    recs.push(`Unrequested changes (scope drift): ${formatList(missedChangedFiles)} — confirm they belong in this change or split them out.`);
  }
  if (unconfirmedCandidates.length) {
    recs.push(`Predicted owner files were not changed: ${formatList(unconfirmedCandidates)} — verify the change landed in the right place.`);
  }
  if (recs.length === 0) {
    recs.push("Change converges on the stated task with no scope drift. Stamp the receipt on the commit as durable evidence.");
  }
  return recs;
}

/**
 * @param {Record<string, any>} data
 * @returns {string}
 */
export function formatConvergenceMarkdown(data) {
  const d = data.drivers;
  const lines = [
    `# Convergence: ${data.convergence}/100 (${data.band})`,
    "",
    `Repo: ${data.repo.name}`,
    `Task: "${data.task}"`,
    `Base: ${data.base}`,
    `Receipt: ${data.receipt.id} (${data.receipt.algorithm})`,
    "",
    "## Sub-scores",
    "",
    `- Coverage:       ${data.subScores.coverage} (did the intent happen?)`,
    `- Scope:          ${data.subScores.scope} (did only the intent happen?)`,
    `- Risk alignment: ${data.subScores.riskAlignment} (did drift land somewhere dangerous?)`,
    "",
    "## Drivers",
    "",
    `- Changed files: ${d.changedFiles}`,
    `- Predicted owners: ${d.predictedDirect}`,
    `- Confirmed direct: ${formatList(d.confirmedDirect)}`,
    `- Confirmed related: ${formatList(d.confirmedRelated)}`,
    `- Unconfirmed candidates: ${formatList(d.unconfirmedCandidates)}`,
    `- Missed (scope drift): ${formatList(d.missedChangedFiles)}`,
  ];
  if (d.riskyDrift.length) {
    lines.push(`- Risky drift: ${d.riskyDrift.map((/** @type {any} */ r) => `${r.file} [${r.flags.join(", ")}]`).join("; ")}`);
  }
  if (data.recommendations.length) {
    lines.push("", "## Recommendations", "");
    for (const rec of data.recommendations) lines.push(`- ${rec}`);
  }
  return lines.join("\n");
}

/**
 * @param {string[]} items
 * @returns {string}
 */
function formatList(items) {
  return items && items.length ? items.map((item) => `\`${item}\``).join(", ") : "none";
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * @param {number} convergence
 * @returns {string}
 */
export function bandFor(convergence) {
  if (convergence >= 80) return "aligned";
  if (convergence >= 50) return "partial";
  return "drift";
}
