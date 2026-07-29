// otito convergence: a deterministic 0–100 measure of the distance between a
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
import { spawnSync } from "node:child_process";
import path from "node:path";
import { generateCodeMapFromSources } from "./code-map.js";
import { isSourceFilePath } from "./code-map/generate.js";
import { DIFF_RENAME_LIMIT, generateImpact } from "./impact.js";
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

const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_BATCH_BYTES = 8 * 1024 * 1024;
const MAX_BATCH_FILES = 256;
const MAX_SUBJECT_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_SUBJECT_SOURCE_FILES = 5000;

/**
 * @param {string} query
 * @param {{ path?: string, base?: string, top?: number, staged?: boolean, subject?: Record<string, unknown>, diffFiles?: string[] }} [options]
 * @returns {Record<string, any>}
 */
export function generateConvergence(query, options = {}) {
  const repoPath = options.path ?? ".";
  const top = options.top ?? 10;
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery) {
    throw new Error('converge requires a task, e.g. `otito converge "add Stripe refunds" --base origin/main`');
  }
  const base = String(options.base ?? "").trim();
  if (!base) {
    throw new Error('converge requires a --base git ref to diff against, e.g. `otito converge "<task>" --base origin/main`');
  }

  const suppliedSubject = options.subject !== undefined && options.subject !== null;
  const suppliedDiffFiles = Array.isArray(options.diffFiles);
  if (suppliedSubject !== suppliedDiffFiles) throw new Error("exact change subject and diff files must be supplied together");
  let subject = normalizeReceiptSubject(options.subject);
  if (suppliedSubject && !subject) throw new Error("converge received an invalid exact change subject");
  let diffFiles = suppliedDiffFiles ? options.diffFiles : undefined;
  const root = repositoryRoot(repoPath);
  if (options.staged && !subject) {
    const captured = captureStagedSubject(root, base);
    subject = captured.subject;
    diffFiles = captured.changedFiles;
  }
  if (subject?.kind === "git-index") {
    const capturedFiles = changedFilesForTree(root, String(subject.baseSha), String(subject.treeSha));
    if (!sameFiles(capturedFiles, diffFiles ?? [])) throw new Error("supplied diff files do not match the staged Git tree subject");
  }
  if (subject?.kind === "github-pr") {
    const capturedFiles = changedFilesForPullRequest(root, String(subject.baseSha), String(subject.headSha));
    if (!sameFiles(capturedFiles, diffFiles ?? [])) throw new Error("supplied diff files do not match the GitHub PR commit subject");
  }

  const codeMap = subject ? codeMapForSubject(root, subject) : undefined;
  /** @type {any} */
  const impact = generateImpact(normalizedQuery, { path: repoPath, top, diffBase: base, diffFiles, codeMap }).data;
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

  const commit = subject?.headSha ?? subject?.parentSha ?? currentCommit(impact.repo?.root ?? repoPath);

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
  if (subject) data.subject = subject;

  // Recomputable receipt — the video's "tamper-evident attestation". The hash
  // deliberately excludes generatedAt so anyone with the same repo state, task,
  // and engine version regenerates the SAME hash and can compare it to the one
  // stamped on the commit. Identity, not timestamp.
  data.receipt = makeReceipt({
    engine: convergenceEngineVersion,
    task: normalizedQuery,
    base,
    commit,
    subject,
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
 * @returns {{ id: string, algorithm: string, commit: string|null, inputsHash: string, receiptVersion?: number, subject?: Record<string, string | number> }}
 */
export function makeReceipt(payload) {
  const subject = normalizeReceiptSubject(payload.subject);
  if (payload.subject !== undefined && payload.subject !== null && !subject) throw new Error("invalid exact change subject");
  const commit = subject ? String(payload.commit ?? "").toLowerCase() : (payload.commit ?? null);
  if (subject) {
    const expectedCommit = subject.kind === "git-index" ? subject.parentSha : subject.headSha;
    if (commit !== expectedCommit) throw new Error("receipt commit does not match its exact change subject");
  }
  /** @type {Record<string, any>} */
  const canonical = {
    engine: payload.engine,
    task: payload.task,
    base: payload.base,
    commit,
    convergence: payload.convergence,
    subScores: payload.subScores,
    changedFiles: [...(payload.changedFiles ?? [])].sort(),
    confirmedDirect: [...(payload.confirmedDirect ?? [])].sort(),
    confirmedRelated: [...(payload.confirmedRelated ?? [])].sort(),
    unconfirmedCandidates: [...(payload.unconfirmedCandidates ?? [])].sort(),
    missedChangedFiles: [...(payload.missedChangedFiles ?? [])].sort(),
  };
  // Subject-aware receipts are v2. When no subject is supplied, the canonical
  // v1 payload remains byte-for-byte compatible with existing receipt IDs.
  if (subject) {
    canonical.receiptVersion = 2;
    canonical.subject = subject;
  }
  const inputsHash = crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  /** @type {{ id: string, algorithm: string, commit: string | null, inputsHash: string, receiptVersion?: number, subject?: Record<string, string | number> }} */
  const receipt = { id: `rcpt_${inputsHash.slice(0, 12)}`, algorithm: "sha256", commit, inputsHash };
  if (subject) {
    receipt.receiptVersion = 2;
    receipt.subject = subject;
  }
  return receipt;
}

/**
 * Identify the exact commit candidate represented by the Git index. A staged
 * change does not have a commit SHA yet, so Git's canonical tree object is the
 * immutable subject; HEAD is recorded separately as its parent.
 * @param {string} root
 * @param {string} base
 * @returns {{ subject: { kind: string, baseSha: string, parentSha: string, treeSha: string }, changedFiles: string[] }}
 */
export function captureStagedSubject(root, base) {
  const baseSha = resolveGitObject(root, `${base}^{commit}`, "base commit");
  const parentSha = resolveGitObject(root, "HEAD^{commit}", "HEAD commit");
  const treeSha = gitValue(root, ["write-tree"], "staged Git tree");
  const changedFiles = changedFilesForTree(root, baseSha, treeSha);
  return { subject: { kind: "git-index", baseSha, parentSha, treeSha }, changedFiles };
}

/**
 * Build the scoring map from the immutable subject tree, never from mutable
 * working-tree content. Raw blobs are read through `git cat-file --batch`, so
 * checkout filters and hooks cannot execute while a receipt is being scored.
 * @param {string} root
 * @param {Record<string, string | number>} subject
 * @returns {any}
 */
function codeMapForSubject(root, subject) {
  const treeish = subject.kind === "git-index" ? String(subject.treeSha) : String(subject.headSha);
  const treeSha = resolveGitObject(root, `${treeish}^{tree}`, "change subject tree");
  const entries = gitTreeEntries(root, treeSha).filter(
    (entry) => (entry.mode === "100644" || entry.mode === "100755") && entry.type === "blob" && isSourceFilePath(entry.file) && entry.size <= MAX_SOURCE_BYTES,
  );
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (entries.length > MAX_SUBJECT_SOURCE_FILES || totalBytes > MAX_SUBJECT_SOURCE_BYTES) {
    throw new Error(
      `exact-subject source set exceeds the safe analysis limit (${MAX_SUBJECT_SOURCE_FILES} files or ${MAX_SUBJECT_SOURCE_BYTES / (1024 * 1024)} MiB)`,
    );
  }
  return generateCodeMapFromSources(root, readRawSources(root, entries), { name: path.basename(root) });
}

/**
 * @param {string} root
 * @param {string} baseSha
 * @param {string} treeSha
 * @returns {string[]}
 */
function changedFilesForTree(root, baseSha, treeSha) {
  return gitNullLines(
    root,
    [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--ignore-submodules=none",
      "--diff-algorithm=myers",
      "--find-renames=50%",
      `-l${DIFF_RENAME_LIMIT}`,
      "--name-only",
      "--relative",
      "-z",
      baseSha,
      treeSha,
      "--",
    ],
    "files in the staged Git tree",
  );
}

/**
 * GitHub's pull-request file set is a three-dot comparison: changes on the
 * head since its merge base with the current base. A direct base..head diff
 * would incorrectly include changes made only on an advanced base branch.
 * @param {string} root
 * @param {string} baseSha
 * @param {string} headSha
 * @returns {string[]}
 */
function changedFilesForPullRequest(root, baseSha, headSha) {
  const mergeBase = gitValue(root, ["merge-base", baseSha, headSha], "GitHub PR merge base");
  return changedFilesForTree(root, mergeBase, headSha);
}

/** @param {string[]} left @param {string[]} right @returns {boolean} */
function sameFiles(left, right) {
  /** @param {string[]} files */
  const normalized = (files) => [...new Set(files.map(String).filter(Boolean))].sort();
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

/**
 * @typedef {Object} GitTreeEntry
 * @property {string} mode
 * @property {string} type
 * @property {string} oid
 * @property {number} size
 * @property {string} file
 */

/**
 * @param {string} root
 * @param {string} treeSha
 * @returns {GitTreeEntry[]}
 */
function gitTreeEntries(root, treeSha) {
  const records = gitNullLines(root, ["ls-tree", "-r", "-l", "-z", treeSha], "files in the change subject tree");
  return records.map((record) => {
    const separator = record.indexOf("\t");
    const header = separator >= 0 ? record.slice(0, separator).trim().split(/\s+/) : [];
    const file = separator >= 0 ? record.slice(separator + 1) : "";
    const [mode, type, oid, sizeText] = header;
    const parsedSize = Number(sizeText);
    const size = Number.isSafeInteger(parsedSize) && parsedSize >= 0 ? parsedSize : 0;
    if (!mode || !type || !file || !isObjectId(oid ?? "") || (type === "blob" && (!Number.isSafeInteger(parsedSize) || parsedSize < 0))) {
      throw new Error("could not parse a safe regular path from the change subject tree");
    }
    return { mode, type, oid, size, file };
  });
}

/**
 * Yield exact raw source text without invoking checkout, clean/smudge filters,
 * Git LFS, or hooks. Each batch is analyzed before the next one is read, so raw
 * blob data is never accumulated for the whole repository.
 * @param {string} root
 * @param {GitTreeEntry[]} entries
 * @returns {Generator<{ path: string, text: string }, void, void>}
 */
function* readRawSources(root, entries) {
  /** @type {GitTreeEntry[]} */
  let batch = [];
  let batchBytes = 0;

  for (const entry of entries) {
    if (batch.length > 0 && (batch.length >= MAX_BATCH_FILES || batchBytes + entry.size > MAX_BATCH_BYTES)) {
      yield* readRawSourceBatch(root, batch, batchBytes);
      batch = [];
      batchBytes = 0;
    }
    batch.push(entry);
    batchBytes += entry.size;
  }
  if (batch.length > 0) yield* readRawSourceBatch(root, batch, batchBytes);
}

/**
 * @param {string} root
 * @param {GitTreeEntry[]} entries
 * @param {number} contentBytes
 * @returns {Generator<{ path: string, text: string }, void, void>}
 */
function* readRawSourceBatch(root, entries, contentBytes) {
  const blobs = readBlobBatch(root, entries, contentBytes);
  for (const entry of entries) {
    const content = blobs.get(entry.file);
    if (!content) throw new Error(`change subject blob was missing for ${JSON.stringify(entry.file)}`);
    yield { path: entry.file, text: content.toString("utf8") };
  }
}

/**
 * @param {string} root
 * @param {GitTreeEntry[]} entries
 * @param {number} contentBytes
 * @returns {Map<string, Buffer>}
 */
function readBlobBatch(root, entries, contentBytes) {
  const input = `${entries.map((entry) => entry.oid).join("\n")}\n`;
  const result = spawnSync("git", ["cat-file", "--batch"], {
    cwd: root,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
    input,
    encoding: null,
    timeout: 120000,
    maxBuffer: Math.max(1024 * 1024, contentBytes + entries.length * 200),
  });
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
  if (result.status !== 0 || result.error) {
    const detail = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8").trim()
      : String(result.stderr || result.error?.message || "command failed").trim();
    throw new Error(`could not read change subject blobs: ${detail || "command failed"}`);
  }

  let offset = 0;
  const blobs = new Map();
  for (const entry of entries) {
    const headerEnd = stdout.indexOf(10, offset);
    if (headerEnd < 0) throw new Error("could not parse change subject blob header");
    const [oid, type, sizeText] = stdout.subarray(offset, headerEnd).toString("ascii").split(" ");
    const size = Number(sizeText);
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (
      oid !== entry.oid ||
      type !== "blob" ||
      size !== entry.size ||
      !Number.isSafeInteger(size) ||
      contentEnd >= stdout.length ||
      stdout[contentEnd] !== 10
    ) {
      throw new Error("change subject blob did not match its tree entry");
    }

    blobs.set(entry.file, Buffer.from(stdout.subarray(contentStart, contentEnd)));
    offset = contentEnd + 1;
  }
  if (offset !== stdout.length) throw new Error("change subject blob stream contained unexpected trailing data");
  return blobs;
}

/**
 * Canonicalise the fixed subject fields rather than hashing arbitrary object
 * key order. Unknown metadata is intentionally excluded from the receipt.
 * @param {unknown} value
 * @returns {Record<string, string | number> | null}
 */
function normalizeReceiptSubject(value) {
  if (!value || typeof value !== "object") return null;
  const input = /** @type {Record<string, unknown>} */ (value);
  const kind = String(input.kind ?? "").trim();
  const baseSha = String(input.baseSha ?? "")
    .trim()
    .toLowerCase();
  if (!isObjectId(baseSha)) return null;

  if (kind === "git-index") {
    const parentSha = String(input.parentSha ?? "")
      .trim()
      .toLowerCase();
    const treeSha = String(input.treeSha ?? "")
      .trim()
      .toLowerCase();
    if (!isObjectId(parentSha) || !isObjectId(treeSha)) return null;
    return { kind, baseSha, parentSha, treeSha };
  }

  if (kind !== "github-pr") return null;
  const repository = String(input.repository ?? "")
    .trim()
    .toLowerCase();
  const number = Number(input.number);
  const headSha = String(input.headSha ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository) || !Number.isSafeInteger(number) || number <= 0 || !isObjectId(headSha)) return null;
  return { kind, repository, number, baseSha, headSha };
}

/** @param {string} value @returns {boolean} */
function isObjectId(value) {
  return /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(value);
}

/**
 * @param {string} root
 * @param {string} ref
 * @param {string} label
 * @returns {string}
 */
function resolveGitObject(root, ref, label) {
  return gitValue(root, ["rev-parse", "--verify", "--end-of-options", ref], label);
}

/**
 * @param {string} root
 * @param {string[]} args
 * @param {string} label
 * @returns {string}
 */
function gitValue(root, args, label) {
  const result = runCommand("git", ["--no-replace-objects", ...args], { cwd: root });
  const value = result.stdout.trim();
  if (result.ok && value) return value;
  const detail = (result.stderr || result.error?.message || result.stdout || "command failed").trim();
  throw new Error(`could not resolve ${label}: ${detail}`);
}

/**
 * @param {string} root
 * @param {string[]} args
 * @param {string} label
 * @returns {string[]}
 */
function gitNullLines(root, args, label) {
  const output = commandOrThrow(root, args, label);
  return [...new Set(output.split("\0").filter(Boolean))].sort();
}

/**
 * @param {string} root
 * @param {string[]} args
 * @param {string} label
 * @returns {string}
 */
function commandOrThrow(root, args, label) {
  const result = runCommand("git", ["--no-replace-objects", ...args], { cwd: root });
  if (result.ok) return result.stdout;
  const detail = (result.stderr || result.error?.message || result.stdout || "command failed").trim();
  throw new Error(`could not resolve ${label}: ${detail}`);
}

/**
 * @param {string} root
 * @returns {string|null}
 */
function currentCommit(root) {
  const result = runCommand("git", ["--no-replace-objects", "rev-parse", "HEAD"], { cwd: root });
  if (!result.ok) return null;
  const sha = result.stdout.trim();
  return sha || null;
}

/** @param {string} repoPath @returns {string} */
function repositoryRoot(repoPath) {
  return gitValue(repoPath, ["rev-parse", "--show-toplevel"], "Git repository root");
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
    recs.push("The task did not ground to any predicted owner files; rephrase it or run `otito impact` to check grounding before trusting this score.");
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
    `Receipt handle: ${data.receipt.id} (${data.receipt.algorithm})`,
    ...(data.receipt.receiptVersion === 2 ? [`Inputs hash: ${data.receipt.inputsHash}`] : []),
    ...(data.subject ? [`Subject: ${formatReceiptSubject(data.subject)}`] : []),
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

/** @param {Record<string, any>} subject @returns {string} */
function formatReceiptSubject(subject) {
  if (subject.kind === "git-index") return `Git index tree ${subject.treeSha} (parent ${subject.parentSha})`;
  if (subject.kind === "github-pr") return `${subject.repository ?? "GitHub PR"}#${subject.number ?? "?"} ${subject.baseSha}..${subject.headSha}`;
  return String(subject.kind ?? "unknown");
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
